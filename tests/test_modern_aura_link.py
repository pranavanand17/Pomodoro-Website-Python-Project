"""Run: python3 -m unittest discover -s tests -v (requires only stdlib)."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from server import timer_request_is_same_origin

PROJECT = Path(__file__).resolve().parents[1]

class ApiCompatibilityTests(unittest.TestCase):
    def test_timer_api_allows_local_and_render_same_origin_only(self):
        with patch.dict(os.environ, {'RENDER_EXTERNAL_HOSTNAME':''}):
            self.assertTrue(timer_request_is_same_origin(
                '127.0.0.1:8000', 'http://127.0.0.1:8000', 'same-origin', 8000))
            self.assertFalse(timer_request_is_same_origin(
                '127.0.0.1:8001', 'http://127.0.0.1:8001', 'same-origin', 8000))

        with patch.dict(os.environ, {'RENDER_EXTERNAL_HOSTNAME':'pomodoro.onrender.com'}):
            self.assertTrue(timer_request_is_same_origin(
                'pomodoro.onrender.com', 'https://pomodoro.onrender.com', 'same-origin', 8000))
            self.assertFalse(timer_request_is_same_origin(
                'pomodoro.onrender.com', 'http://pomodoro.onrender.com', 'same-origin', 8000))
            self.assertFalse(timer_request_is_same_origin(
                'evil.onrender.com', 'https://evil.onrender.com', 'same-origin', 8000))
            self.assertFalse(timer_request_is_same_origin(
                'pomodoro.onrender.com', 'https://pomodoro.onrender.com', 'cross-site', 8000))

    @classmethod
    def setUpClass(cls):
        import socket
        cls.temp = tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.base = 'http://127.0.0.1:' + str(cls.port)
        class StubAura(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/api/integration/decks':
                    data = {'decks': [{'id':'modern-1','name':'Sample deck', 'cards':[{'id':'c1','question':'Q?', 'answer':'A.'}]}]}
                elif self.path == '/api/integrations/summary':
                    data = {'service':'auracards', 'completed_sessions':2,'total_minutes':50}
                else:
                    self.send_error(404); return
                body = json.dumps(data).encode()
                self.send_response(200); self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def log_message(self, *args): pass
        cls.stub = ThreadingHTTPServer(('127.0.0.1',0), StubAura)
        cls.thread = Thread(target=cls.stub.serve_forever, daemon=True)
        cls.thread.start()
        env = os.environ.copy()
        env.update(PORT=str(cls.port), POMODORO_DB=str(Path(cls.temp.name) / 'database.db'),
                   AURA_URL=f'http://127.0.0.1:{cls.stub.server_port}',
                   AURACARDS_URL=f'http://127.0.0.1:{cls.stub.server_port}',
                   STUDY_INTEGRATION_TOKEN='z'*48)
        cls.proc = subprocess.Popen([sys.executable, '-u', 'server.py'], cwd=PROJECT,
                                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for attempt in range(90):
            try:
                if cls.get('/api/health')['status'] == 'ok': break
            except Exception: time.sleep(.07)
        else:
            cls.tearDownClass()
            raise RuntimeError('Pomodoro did not start')

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'proc'):
            cls.proc.terminate()
            try: cls.proc.wait(timeout=3)
            except subprocess.TimeoutExpired: cls.proc.kill()
        if hasattr(cls, 'stub'): cls.stub.shutdown(); cls.stub.server_close()
        if hasattr(cls, 'temp'): cls.temp.cleanup()

    @classmethod
    def get(cls, path, headers=None):
        with urlopen(Request(cls.base + path, headers=headers or {}), timeout=3) as result:
            return json.load(result)

    @classmethod
    def post(cls, path, data, headers=None):
        request = Request(cls.base + path, data=json.dumps(data).encode(),
                          headers={'Content-Type':'application/json', **(headers or {})})
        with urlopen(request, timeout=3) as result:
            return json.load(result)

    def test_legacy_ui_unchanged_and_bridge_loaded(self):
        html = (PROJECT / 'index.html').read_text()
        self.assertIn('script.js?v=2.2.1', html)
        self.assertIn('aura-sync.js?v=1', html)
        self.assertIn('auraCardsFrame', html)
        self.assertIn('Focus', html)

    def test_timer_sync_and_commands(self):
        s = self.get('/api/timer')
        self.assertIn(s['mode'], ('focus', 'shortBreak', 'longBreak'))
        original_duration = s['remaining_seconds']
        s = self.post('/api/timer', {'revision':s['revision'], 'action':'start'})
        self.assertTrue(s['running'])
        s = self.post('/api/timer', {'revision':s['revision'], 'action':'pause'})
        self.assertFalse(s['running'])
        self.assertLessEqual(s['remaining_seconds'],original_duration)
        s = self.post('/api/timer', {'revision':s['revision'], 'action':'mode', 'mode':'shortBreak'})
        self.assertEqual(s['remaining_seconds'],s['settings']['shortBreak']*60)
        s = self.post('/api/timer', {'revision':s['revision'], 'action':'reset'})
        self.assertEqual(s['mode'], 'shortBreak')
        self.assertFalse(s['running'])
        with self.assertRaises(HTTPError) as err:
            self.post('/api/timer', {'revision': s['revision'] - 1, 'action':'start'})
        self.assertEqual(err.exception.code, 409)

    def test_settings_original_form_syncs_new_api(self):
        s = self.get('/api/timer')
        form = {'focus':35,'shortBreak':7,'longBreak':20,'autoStartBreaks':False,'autoStartFocus':False}
        response = self.post('/api/settings', {'settings':form})
        self.assertEqual(response['settings'],form)
        after = self.get('/api/timer')
        self.assertEqual(after['settings'],form)
        self.assertEqual(after['revision'],s['revision']+1)
        self.assertFalse(after['running'])

    def test_decks_and_legacy_summary_reach_modern_aura(self):
        decks = self.get('/api/aura/decks')
        self.assertEqual(decks['decks'][0]['id'], 'modern-1')
        stats = self.get('/api/integrations/auracards')
        self.assertEqual(stats['completed_sessions'], 2)
        self.assertEqual(stats['total_minutes'],50)

    def test_peer_endpoint_origin_filter(self):
        with self.assertRaises(HTTPError) as err:
            self.get('/api/timer',headers={'Origin':'http://evil.test'})
        self.assertEqual(err.exception.code,403)
        with self.assertRaises(HTTPError) as err:
            self.post('/api/timer', {'action':'start', 'revision':0}, headers={'Origin':'http://evil.test'})
        self.assertEqual(err.exception.code,403)

if __name__ == '__main__': unittest.main()
