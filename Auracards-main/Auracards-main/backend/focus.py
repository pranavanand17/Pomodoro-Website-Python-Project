"""Local focus metadata. No documents, cards or deck names are persisted."""
import hashlib
import hmac
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from .errors import UserError


class FocusStore:
    def __init__(self, path, clock=time.time):
        self.path, self.clock = str(path), clock
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS focus_sessions (
                id TEXT PRIMARY KEY, device TEXT NOT NULL, deck_id TEXT NOT NULL,
                token_hash TEXT NOT NULL, timer_origin TEXT NOT NULL,
                duration INTEGER NOT NULL, created REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', active REAL NOT NULL DEFAULT 0,
                running_since REAL, completed REAL)""")
            db.execute("CREATE INDEX IF NOT EXISTS focus_device ON focus_sessions(device)")
            db.execute("DELETE FROM focus_sessions WHERE created < ?", (clock() - 90 * 86400,))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, device, deck_id, minutes, timer_origin):
        if not isinstance(deck_id, str) or not 1 <= len(deck_id) <= 100:
            raise UserError("Select a valid deck for the focus session.", 400, "invalid_deck")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or not 1 <= minutes <= 120:
            raise UserError("Focus duration must be between 1 and 120 minutes.", 400, "invalid_duration")
        sid, token = str(uuid.uuid4()), secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute("SELECT count(*) FROM focus_sessions WHERE device=? AND status IN ('pending','running','paused') AND created>?", (device, self.clock() - 86400)).fetchone()[0]
            if active >= 10:
                raise UserError("Too many open timers. Finish or cancel an existing session.", 429, "focus_limit")
            db.execute("INSERT INTO focus_sessions(id,device,deck_id,token_hash,timer_origin,duration,created) VALUES (?,?,?,?,?,?,?)", (sid, device, deck_id, hashlib.sha256(token.encode()).hexdigest(), timer_origin, minutes * 60, self.clock()))
        return {"session_id": sid, "completion_token": token, "duration_seconds": minutes * 60}

    def _authorized(self, db, sid, token):
        row = db.execute("SELECT * FROM focus_sessions WHERE id=?", (sid,)).fetchone()
        digest = hashlib.sha256(token.encode()).hexdigest() if isinstance(token, str) else ""
        if not row or not hmac.compare_digest(row["token_hash"], digest):
            raise UserError("This focus session is not authorized.", 401, "unauthorized_session")
        if self.clock() - row["created"] > 48 * 3600:
            raise UserError("This focus session has expired. Start a new one.", 410, "session_expired")
        return row

    def _elapsed(self, row):
        return row["active"] + (max(0, self.clock() - row["running_since"]) if row["status"] == "running" else 0)

    def _public(self, row):
        elapsed = self._elapsed(row)
        return {"session_id": row["id"], "deck_id": row["deck_id"], "status": row["status"], "duration_seconds": row["duration"], "elapsed_seconds": min(row["duration"], elapsed), "remaining_seconds": max(0, row["duration"] - elapsed)}

    @staticmethod
    def check_origin(row, origin):
        if origin and origin != row["timer_origin"]:
            raise UserError("This timer origin is not authorized.", 403, "timer_origin")

    def get(self, sid, token, origin=None):
        with self.connect() as db:
            row = self._authorized(db, sid, token)
            self.check_origin(row, origin)
            return self._public(row)

    def control(self, sid, token, action, origin=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._authorized(db, sid, token)
            self.check_origin(row, origin)
            status, elapsed = row["status"], self._elapsed(row)
            if action == "start" and status in ("pending", "paused"):
                db.execute("UPDATE focus_sessions SET status='running', running_since=? WHERE id=?", (self.clock(), sid))
            elif action == "pause" and status == "running":
                db.execute("UPDATE focus_sessions SET status='paused', active=?, running_since=NULL WHERE id=?", (elapsed, sid))
            elif action == "cancel" and status not in ("completed", "cancelled"):
                db.execute("UPDATE focus_sessions SET status='cancelled', active=?, running_since=NULL WHERE id=?", (elapsed, sid))
            elif action == "complete":
                if status == "completed":
                    return self._public(row)
                if status != "running" or elapsed + .1 < row["duration"]:
                    raise UserError("The full active focus duration has not elapsed.", 409, "session_incomplete")
                db.execute("UPDATE focus_sessions SET status='completed', active=duration, running_since=NULL, completed=? WHERE id=?", (self.clock(), sid))
            elif action not in ("start", "pause", "cancel"):
                raise UserError("Unknown timer action.", 400, "invalid_action")
            elif not ((action == "start" and status == "running") or (action == "pause" and status == "paused") or (action == "cancel" and status == "cancelled")):
                raise UserError("This action is not available in the current timer state.", 409, "invalid_transition")
            return self._public(db.execute("SELECT * FROM focus_sessions WHERE id=?", (sid,)).fetchone())

    def summary(self, device):
        with self.connect() as db:
            rows = db.execute("SELECT id,duration,completed FROM focus_sessions WHERE device=? AND status='completed' ORDER BY completed DESC LIMIT 1000", (device,)).fetchall()
            totals = db.execute("SELECT count(*),coalesce(sum(duration),0) FROM focus_sessions WHERE device=? AND status='completed'", (device,)).fetchone()
        return {"completed_sessions": totals[0], "total_minutes": totals[1] // 60, "sessions": [{"session_id": r["id"], "minutes": r["duration"] // 60, "completed_at": r["completed"]} for r in rows]}

    def clear(self, device):
        with self.connect() as db:
            db.execute("DELETE FROM focus_sessions WHERE device=?", (device,))
