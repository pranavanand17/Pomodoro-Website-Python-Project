
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
DB_FILE = BASE_DIR / "pomodoro.db"

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8000"))

GEMINI_MODEL = os.environ.get(
    "GEMINI_MODEL",
    "gemini-3.5-flash"
)

DEFAULT_SETTINGS = {
    "focus": 25,
    "shortBreak": 5,
    "longBreak": 15,
    "autoStartBreaks": False,
    "autoStartFocus": False,
}

STUDY_ASSISTANT_PROMPT = """
You are Study Sidekick, an AI study assistant inside a Pomodoro
productivity website.

Your responsibilities:
- Explain difficult concepts in clear, student-friendly language.
- Give examples, analogies, summaries, and step-by-step explanations.
- Help users understand problems instead of immediately giving away
  answers when teaching would be more useful.
- Adapt explanations to the user's apparent level of understanding.
- Keep responses reasonably concise unless more detail is requested.
- Help with academic subjects, programming, mathematics, and
  general learning questions.
- If a question is ambiguous, ask for clarification.
- Never claim you can see the user's screen, files, or study notes
  unless that information has actually been provided.
- Format answers clearly using plain text or Markdown.
- Do not claim to have changed the timer, tasks, settings, or database.
"""


# ============================================================
# DATABASE CONNECTION AND TRANSACTIONS
# ============================================================

def connect_db():
    connection = sqlite3.connect(DB_FILE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database():
    db = connect_db()

    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize_db():
    with database() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject_id INTEGER,
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY(subject_id) REFERENCES subjects(id)
                    ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                duration INTEGER NOT NULL,
                task_id INTEGER,
                subject_id INTEGER,
                task_name TEXT,
                subject_name TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
                    ON DELETE SET NULL,
                FOREIGN KEY(subject_id) REFERENCES subjects(id)
                    ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS app_data (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_date
                ON sessions(date);

            CREATE INDEX IF NOT EXISTS idx_sessions_subject
                ON sessions(subject_id);

            CREATE INDEX IF NOT EXISTS idx_tasks_subject
                ON tasks(subject_id);
        """)

        db.execute(
            "INSERT OR IGNORE INTO app_data (key, value) VALUES (?, ?)",
            ("settings", json.dumps(DEFAULT_SETTINGS))
        )

        db.execute(
            "INSERT OR IGNORE INTO app_data (key, value) VALUES (?, ?)",
            ("notes", json.dumps(""))
        )


def get_app_value(db, key, default):
    row = db.execute(
        "SELECT value FROM app_data WHERE key = ?",
        (key,)
    ).fetchone()

    if not row:
        return default

    try:
        return json.loads(row["value"])
    except (ValueError, TypeError):
        return default


def set_app_value(db, key, value):
    db.execute("""
        INSERT INTO app_data (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    """, (key, json.dumps(value)))


# ============================================================
# STATISTICS AND ANALYTICS
# ============================================================

def get_stats(db):
    today = date.today()
    today_string = today.isoformat()

    sessions = [
        dict(row)
        for row in db.execute("""
            SELECT id, date, time, duration, task_id, subject_id,
                   task_name, subject_name
            FROM sessions
            ORDER BY date DESC, time DESC, id DESC
        """).fetchall()
    ]

    today_sessions = [
        session for session in sessions
        if session["date"] == today_string
    ]

    week_start = today - timedelta(days=6)
    weekly = {}

    for offset in range(7):
        day = week_start + timedelta(days=offset)

        weekly[day.isoformat()] = {
            "date": day.isoformat(),
            "label": day.strftime("%a"),
            "minutes": 0,
            "sessions": 0,
        }

    for session in sessions:
        day = weekly.get(session["date"])

        if day:
            day["minutes"] += session["duration"]
            day["sessions"] += 1

    subject_totals = {}

    for session in sessions:
        name = session["subject_name"] or "Unassigned"

        subject_totals[name] = (
            subject_totals.get(name, 0) + session["duration"]
        )

    subject_breakdown = [
        {"name": name, "minutes": minutes}
        for name, minutes in sorted(
            subject_totals.items(),
            key=lambda item: item[1],
            reverse=True
        )
    ]

    tasks = db.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(
                CASE WHEN completed = 1 THEN 1 ELSE 0 END
            ) AS completed
        FROM tasks
    """).fetchone()

    task_total = tasks["total"] or 0
    task_completed = tasks["completed"] or 0

    study_dates = {
        session["date"] for session in sessions
    }

    streak = 0
    streak_day = today

    if today_string not in study_dates:
        streak_day = today - timedelta(days=1)

    while streak_day.isoformat() in study_dates:
        streak += 1
        streak_day -= timedelta(days=1)

    total_minutes = sum(
        session["duration"] for session in sessions
    )

    weekly_days = list(weekly.values())

    return {
        "today": {
            "minutes": sum(
                session["duration"] for session in today_sessions
            ),
            "sessions": len(today_sessions),
        },
        "week": {
            "minutes": sum(
                day["minutes"] for day in weekly_days
            ),
            "sessions": sum(
                day["sessions"] for day in weekly_days
            ),
            "days": weekly_days,
        },
        "all_time": {
            "minutes": total_minutes,
            "sessions": len(sessions),
        },
        "streak": streak,
        "subjects": subject_breakdown,
        "tasks": {
            "total": task_total,
            "completed": task_completed,
            "remaining": task_total - task_completed,
        },
    }


# ============================================================
# HTTP HANDLER
# ============================================================

class PomodoroHandler(SimpleHTTPRequestHandler):

    # --------------------------------------------------------
    # RESPONSE HELPERS
    # --------------------------------------------------------

    def send_json(self, data, status=200):
        payload = json.dumps(data).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        self.wfile.write(payload)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")

        if length < 0 or length > 100_000:
            raise ValueError("Request body is too large.")

        raw = self.rfile.read(length)
        data = json.loads(raw.decode("utf-8") or "{}")

        if not isinstance(data, dict):
            raise ValueError("The request body must be a JSON object.")

        return data

    def api_error(self, message, status=400):
        self.send_json({
            "success": False,
            "error": message,
        }, status)

    # --------------------------------------------------------
    # AI STUDY SIDEKICK
    # --------------------------------------------------------

    def handle_chat(self):
        api_key = os.environ.get("GEMINI_API_KEY")

        if not api_key:
            self.api_error(
                "AI is not configured. Set GEMINI_API_KEY in your "
                "terminal and restart the server.",
                503
            )
            return

        try:
            from google import genai
        except ImportError as error:
            print("Gemini SDK unavailable:", type(error).__name__, str(error))
            self.api_error(
                "The Gemini SDK is missing. Install dependencies with "
                "'python -m pip install -r requirements.txt' and restart "
                "the server.",
                503
            )
            return

        try:
            data = self.read_json()

            message = data.get("message", "")

            if not isinstance(message, str):
                self.api_error("The question must be text.")
                return

            message = message.strip()

            if not message:
                self.api_error("Please enter a question.")
                return

            if len(message) > 4000:
                self.api_error(
                    "Questions must be under 4,000 characters."
                )
                return

            history = data.get("history", [])

            if not isinstance(history, list):
                self.api_error(
                    "Conversation history must be a list."
                )
                return

            # Only retain a small amount of recent conversation.
            # The latest question is added separately below.
            conversation = []

            for item in history[-10:]:
                if not isinstance(item, dict):
                    continue

                role = item.get("role")
                content = item.get("content")

                if role not in ("user", "model"):
                    continue

                if not isinstance(content, str):
                    continue

                content = content.strip()

                if not content or len(content) > 4000:
                    continue

                conversation.append({
                    "role": role,
                    "parts": [{"text": content}],
                })

            conversation.append({
                "role": "user",
                "parts": [{"text": message}],
            })

            client = genai.Client(api_key=api_key)

            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=conversation,
                config={
                    "system_instruction": STUDY_ASSISTANT_PROMPT,
                    "temperature": 0.7,
                    "max_output_tokens": 1200,
                },
            )

            answer = response.text

            if not answer:
                self.api_error(
                    "The assistant returned an empty response.",
                    502
                )
                return

            self.send_json({
                "success": True,
                "reply": answer,
            })

        except (ValueError, json.JSONDecodeError):
            self.api_error("Invalid chat request.")

        except Exception as error:
            # Detailed errors stay in the terminal, not in the UI.
            print(
                "Gemini chat error:",
                type(error).__name__,
                str(error)
            )

            error_code = getattr(error, "code", None)
            try:
                error_code = int(error_code)
            except (TypeError, ValueError):
                error_code = None

            if error_code in (401, 403):
                message = (
                    "Gemini rejected the API key or the key does not have "
                    "access to this model. Check GEMINI_API_KEY."
                )
            elif error_code == 404:
                message = (
                    f"The Gemini model '{GEMINI_MODEL}' was not found. "
                    "Check the GEMINI_MODEL setting."
                )
            elif error_code == 429:
                message = (
                    "Gemini's request quota is temporarily unavailable. "
                    "Check the API quota and try again later."
                )
            else:
                message = (
                    "Gemini could not complete the request. Check your "
                    "internet connection and API configuration; details "
                    "were written to the server terminal."
                )

            self.api_error(
                message,
                502
            )

    # --------------------------------------------------------
    # GET: DATA, STATISTICS AND STATIC FILES
    # --------------------------------------------------------

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/data":
            with database() as db:
                subjects = [
                    dict(row)
                    for row in db.execute("""
                        SELECT s.id, s.name, s.created_at,
                               COUNT(t.id) AS task_count,
                               SUM(
                                   CASE WHEN t.completed = 1
                                   THEN 1 ELSE 0 END
                               ) AS completed_count
                        FROM subjects s
                        LEFT JOIN tasks t ON t.subject_id = s.id
                        GROUP BY s.id
                        ORDER BY s.name COLLATE NOCASE
                    """).fetchall()
                ]

                tasks = [
                    dict(row)
                    for row in db.execute("""
                        SELECT t.id, t.title, t.subject_id, t.due_date,
                               t.completed, t.created_at, t.completed_at,
                               s.name AS subject_name
                        FROM tasks t
                        LEFT JOIN subjects s ON s.id = t.subject_id
                        ORDER BY t.completed ASC,
                                 CASE WHEN t.due_date IS NULL
                                      THEN 1 ELSE 0 END,
                                 t.due_date ASC, t.id DESC
                    """).fetchall()
                ]

                for task in tasks:
                    task["completed"] = bool(task["completed"])

                self.send_json({
                    "success": True,
                    "subjects": subjects,
                    "tasks": tasks,
                    "settings": get_app_value(
                        db, "settings", DEFAULT_SETTINGS
                    ),
                    "notes": get_app_value(db, "notes", ""),
                    "stats": get_stats(db),
                })

            return

        if path.startswith("/api/"):
            self.api_error("API endpoint not found.", 404)
            return

        super().do_GET()

    # --------------------------------------------------------
    # POST: CHAT, SUBJECTS, TASKS, SESSIONS, SETTINGS, NOTES
    # --------------------------------------------------------

    def do_POST(self):
        path = urlparse(self.path).path

        # Route chat before the other POST operations.
        if path == "/api/chat":
            self.handle_chat()
            return

        try:
            data = self.read_json()

            # CREATE SUBJECT
            if path == "/api/subjects":
                name = str(data.get("name", "")).strip()

                if not name or len(name) > 60:
                    self.api_error(
                        "Subject names must be 1–60 characters."
                    )
                    return

                with database() as db:
                    cursor = db.execute("""
                        INSERT INTO subjects (name, created_at)
                        VALUES (?, ?)
                    """, (
                        name,
                        datetime.now().isoformat(timespec="seconds")
                    ))

                    self.send_json({
                        "success": True,
                        "id": cursor.lastrowid,
                        "name": name,
                    }, 201)

                return

            # CREATE TASK
            if path == "/api/tasks":
                title = str(data.get("title", "")).strip()
                subject_id = data.get("subject_id")
                due_date = data.get("due_date") or None

                if not title or len(title) > 200:
                    self.api_error(
                        "Task titles must be 1–200 characters."
                    )
                    return

                if due_date:
                    if not isinstance(due_date, str):
                        self.api_error("Invalid due date.")
                        return

                    try:
                        date.fromisoformat(due_date)
                    except ValueError:
                        self.api_error("Invalid due date.")
                        return

                with database() as db:
                    if subject_id not in (None, ""):
                        try:
                            subject_id = int(subject_id)
                        except (ValueError, TypeError):
                            self.api_error("Invalid subject ID.")
                            return

                        subject = db.execute(
                            "SELECT id FROM subjects WHERE id = ?",
                            (subject_id,)
                        ).fetchone()

                        if not subject:
                            self.api_error(
                                "That subject does not exist.",
                                404
                            )
                            return
                    else:
                        subject_id = None

                    cursor = db.execute("""
                        INSERT INTO tasks
                            (title, subject_id, due_date, created_at)
                        VALUES (?, ?, ?, ?)
                    """, (
                        title,
                        subject_id,
                        due_date,
                        datetime.now().isoformat(timespec="seconds")
                    ))

                    self.send_json({
                        "success": True,
                        "id": cursor.lastrowid,
                    }, 201)

                return

            # RECORD COMPLETED FOCUS SESSION
            if path == "/api/session":
                try:
                    duration = int(data.get("duration", 25))
                except (ValueError, TypeError):
                    self.api_error("Invalid session duration.")
                    return

                if not 1 <= duration <= 180:
                    self.api_error(
                        "Duration must be between 1 and 180 minutes."
                    )
                    return

                task_id = data.get("task_id")

                with database() as db:
                    task = None

                    if task_id not in (None, ""):
                        try:
                            task_id = int(task_id)
                        except (ValueError, TypeError):
                            self.api_error("Invalid task ID.")
                            return

                        task = db.execute("""
                            SELECT t.id, t.title, t.subject_id, s.name
                            FROM tasks t
                            LEFT JOIN subjects s ON s.id = t.subject_id
                            WHERE t.id = ?
                        """, (task_id,)).fetchone()

                        if not task:
                            self.api_error(
                                "Selected task was not found.",
                                404
                            )
                            return

                    now = datetime.now()

                    cursor = db.execute("""
                        INSERT INTO sessions
                            (date, time, duration, task_id, subject_id,
                             task_name, subject_name, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        now.date().isoformat(),
                        now.strftime("%H:%M"),
                        duration,
                        task["id"] if task else None,
                        task["subject_id"] if task else None,
                        task["title"] if task else None,
                        task["name"] if task else None,
                        now.isoformat(timespec="seconds"),
                    ))

                    self.send_json({
                        "success": True,
                        "id": cursor.lastrowid,
                    }, 201)

                return

            # UPDATE TIMER SETTINGS
            if path == "/api/settings":
                settings = data.get("settings", data)

                if not isinstance(settings, dict):
                    self.api_error("Settings must be a JSON object.")
                    return

                try:
                    focus = int(settings.get("focus", 25))
                    short_break = int(settings.get("shortBreak", 5))
                    long_break = int(settings.get("longBreak", 15))
                except (ValueError, TypeError):
                    self.api_error(
                        "Timer durations must be numbers."
                    )
                    return

                if not 1 <= focus <= 180:
                    self.api_error(
                        "Focus duration must be 1–180 minutes."
                    )
                    return

                if not 1 <= short_break <= 60:
                    self.api_error(
                        "Short break must be 1–60 minutes."
                    )
                    return

                if not 1 <= long_break <= 90:
                    self.api_error(
                        "Long break must be 1–90 minutes."
                    )
                    return

                clean_settings = {
                    "focus": focus,
                    "shortBreak": short_break,
                    "longBreak": long_break,
                    "autoStartBreaks": bool(
                        settings.get("autoStartBreaks", False)
                    ),
                    "autoStartFocus": bool(
                        settings.get("autoStartFocus", False)
                    ),
                }

                with database() as db:
                    set_app_value(db, "settings", clean_settings)

                self.send_json({
                    "success": True,
                    "settings": clean_settings,
                })

                return

            # SAVE NOTES
            if path == "/api/notes":
                notes = data.get("notes", "")

                if not isinstance(notes, str):
                    self.api_error("Notes must be text.")
                    return

                if len(notes) > 100_000:
                    self.api_error("Notes are too long.")
                    return

                with database() as db:
                    set_app_value(db, "notes", notes)

                self.send_json({"success": True})
                return

            self.api_error("API endpoint not found.", 404)

        except sqlite3.IntegrityError:
            self.api_error(
                "That subject already exists, or the data is invalid."
            )

        except (ValueError, json.JSONDecodeError) as error:
            self.api_error(str(error) or "Invalid request body.")

        except Exception as error:
            print("POST error:", type(error).__name__, str(error))
            self.api_error(
                "The server could not complete that request.",
                500
            )

    # --------------------------------------------------------
    # PATCH: UPDATE TASKS
    # --------------------------------------------------------

    def do_PATCH(self):
        path = urlparse(self.path).path

        try:
            data = self.read_json()
            parts = path.strip("/").split("/")

            if len(parts) != 3 or parts[:2] != ["api", "tasks"]:
                self.api_error("API endpoint not found.", 404)
                return

            try:
                task_id = int(parts[2])
            except ValueError:
                self.api_error("Invalid task ID.")
                return

            with database() as db:
                task = db.execute(
                    "SELECT id FROM tasks WHERE id = ?",
                    (task_id,)
                ).fetchone()

                if not task:
                    self.api_error("Task not found.", 404)
                    return

                if "completed" in data:
                    completed_value = data["completed"]

                    if not isinstance(completed_value, bool):
                        self.api_error(
                            "The completed field must be true or false."
                        )
                        return

                    db.execute("""
                        UPDATE tasks
                        SET completed = ?, completed_at = ?
                        WHERE id = ?
                    """, (
                        int(completed_value),
                        datetime.now().isoformat(timespec="seconds")
                        if completed_value else None,
                        task_id,
                    ))

                self.send_json({"success": True})

        except (ValueError, json.JSONDecodeError):
            self.api_error("Invalid request body.")

        except Exception as error:
            print("PATCH error:", type(error).__name__, str(error))
            self.api_error(
                "The server could not update that task.",
                500
            )

    # --------------------------------------------------------
    # DELETE: REMOVE TASKS OR SUBJECTS
    # --------------------------------------------------------

    def do_DELETE(self):
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")

        if len(parts) != 3 or parts[0] != "api":
            self.api_error("API endpoint not found.", 404)
            return

        kind, raw_id = parts[1], parts[2]

        try:
            item_id = int(raw_id)
        except ValueError:
            self.api_error("Invalid ID.")
            return

        if kind not in ("tasks", "subjects"):
            self.api_error("API endpoint not found.", 404)
            return

        table = "tasks" if kind == "tasks" else "subjects"

        with database() as db:
            existing = db.execute(
                f"SELECT id FROM {table} WHERE id = ?",
                (item_id,)
            ).fetchone()

            if not existing:
                self.api_error("Item not found.", 404)
                return

            db.execute(
                f"DELETE FROM {table} WHERE id = ?",
                (item_id,)
            )

        self.send_json({"success": True})


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":
    initialize_db()
    os.chdir(BASE_DIR)

    server = ThreadingHTTPServer(
        (HOST, PORT),
        PomodoroHandler
    )

    print(
        f"Pomodoro Study Timer running at "
        f"http://{HOST}:{PORT}"
    )
    print("Database:", DB_FILE)
    print("Gemini model:", GEMINI_MODEL)
    print("Press Ctrl+C to stop the server.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
