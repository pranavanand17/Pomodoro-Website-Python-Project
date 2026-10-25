"""Local flashcard sharing and proxy routes for Study Space."""
import json
import sqlite3
from contextlib import closing
from flask import jsonify, request
from .errors import UserError
from .local_bridge import peer_call


def register(app, device, csrf, data_dir):
    path = str(data_dir / "study-library.sqlite3")
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS libraries(owner TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    @app.route('/api/study-library', methods=['POST'])
    def publish():
        csrf()
        data = request.get_json(silent=True)
        decks = data.get('decks') if isinstance(data, dict) else None
        if not isinstance(decks, list) or len(decks) > 500:
            raise UserError('Send up to 500 decks.', 400, 'invalid_decks')
        clean, ids = [], set()
        def text(value, maximum):
            return isinstance(value, str) and 0 < len(value) <= maximum
        for d in decks:
            if not isinstance(d, dict) or not text(d.get('id'), 100) or not text(d.get('name'), 100) or not isinstance(d.get('cards'), list) or len(d['cards']) > 2000 or d['id'] in ids:
                raise UserError('Invalid deck.', 400, 'invalid_deck')
            ids.add(d['id'])
            cards, card_ids = [], set()
            for c in d['cards']:
                if not isinstance(c, dict) or not text(c.get('id'), 100) or not text(c.get('question'), 3000) or not text(c.get('answer'), 10000) or c['id'] in card_ids:
                    raise UserError('Invalid flashcard.', 400, 'invalid_card')
                card_ids.add(c['id'])
                cards.append({k: c[k] for k in ('id', 'question', 'answer')})
            clean.append({'id': d['id'], 'name': d['name'], 'cards': cards})
        payload = json.dumps(clean)
        if len(payload.encode()) > 10 * 1024 * 1024:
            raise UserError('Shared decks must be under 10 MB.', 413, 'library_too_large')
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('INSERT INTO libraries(owner,payload) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload', (device(), payload))
        return jsonify(success=True, decks=len(clean))

    @app.get('/api/integration/decks')
    def peer_decks():
        # This endpoint is only for local server-to-server calls, never browser fetches.
        if request.remote_addr not in ('127.0.0.1', '::1') or request.headers.get('Origin') or request.headers.get('Sec-Fetch-Site'):
            raise UserError('Use the Pomodoro server to read shared decks.', 403, 'peer_only')
        with closing(sqlite3.connect(path)) as db, db:
            decks = [d for row in db.execute('SELECT payload FROM libraries ORDER BY owner') for d in json.loads(row[0])]
        return jsonify(decks=decks)

    @app.route('/api/linked/timer', methods=['GET', 'POST'])
    def linked_timer():
        if request.method == 'POST':
            csrf()
        payload = request.get_json(silent=True) if request.method == 'POST' else None
        if request.method == 'POST' and not isinstance(payload, dict):
            raise UserError('Send a JSON object.', 400, 'invalid_json')
        try:
            data, status = peer_call('POMODORO_URL', 'http://127.0.0.1:8000', '/api/timer', payload)
        except ValueError as error:
            raise UserError(str(error), 503, 'peer_config') from error
        return jsonify(data), status
