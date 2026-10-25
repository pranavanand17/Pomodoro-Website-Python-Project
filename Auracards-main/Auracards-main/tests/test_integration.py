import json
import os
from datetime import date, datetime
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener
from http.server import ThreadingHTTPServer

from werkzeug.serving import make_server

PROJECT_ROOT = Path(__file__).resolve().parents[1]
POMODORO_ROOT = PROJECT_ROOT.parents[1]
sys.path.insert(0, str(POMODORO_ROOT))

import server as pomodoro
from app import create_app, get_bind_host as aura_bind_host


TOKEN = "integration-test-token-" + ("x" * 40)


class BidirectionalIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.original_db = pomodoro.DB_FILE
        self.original_auracards_api_url = pomodoro.AURACARDS_API_URL
        pomodoro.DB_FILE = self.directory / "pomodoro.sqlite3"
        pomodoro.initialize_db()

        with pomodoro.database() as db:
            now = datetime.now()
            db.execute(
                """
                INSERT INTO sessions
                    (date, time, duration, task_id, subject_id,
                     task_name, subject_name, created_at)
                VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)
                """,
                (
                    date.today().isoformat(),
                    now.strftime("%H:%M"),
                    42,
                    now.isoformat(timespec="seconds"),
                ),
            )

        self.pomodoro_server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            pomodoro.PomodoroHandler,
        )
        self.pomodoro_thread = threading.Thread(
            target=self.pomodoro_server.serve_forever,
            daemon=True,
        )
        self.pomodoro_thread.start()
        self.pomodoro_url = (
            f"http://127.0.0.1:{self.pomodoro_server.server_port}"
        )

        self.env = patch.dict(
            os.environ,
            {
                "STUDY_INTEGRATION_TOKEN": TOKEN,
                "AURACARDS_API_URL": "http://127.0.0.1:5000",
            },
        )
        self.env.start()
        self.aura_app = create_app({
            "TESTING": True,
            "DATA_DIR": str(self.directory / "aura-data"),
            "SECRET_KEY": "integration-test-secret",
            "STUDY_INTEGRATION_TOKEN": TOKEN,
            "POMODORO_API_URL": self.pomodoro_url,
            "POMODORO_URL": self.pomodoro_url,
            "AURA_FRAME_ORIGINS": "http://127.0.0.1:5001",
        })

        self.aura_server = make_server(
            "127.0.0.1",
            0,
            self.aura_app,
            threaded=True,
        )
        self.aura_thread = threading.Thread(
            target=self.aura_server.serve_forever,
            daemon=True,
        )
        self.aura_thread.start()
        self.aura_url = f"http://127.0.0.1:{self.aura_server.server_port}"
        pomodoro.AURACARDS_API_URL = self.aura_url
        os.environ["AURACARDS_API_URL"] = self.aura_url

        clock = [1_700_000_000.0]
        store = self.aura_app.extensions["focus_store"]
        store.clock = lambda: clock[0]
        session = store.create(
            "test-device",
            "opaque-deck",
            1,
            self.pomodoro_url,
        )
        store.control(
            session["session_id"],
            session["completion_token"],
            "start",
        )
        clock[0] += 61
        store.control(
            session["session_id"],
            session["completion_token"],
            "complete",
        )

        self.client = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.aura_server.shutdown()
        self.aura_server.server_close()
        self.aura_thread.join(timeout=5)
        self.pomodoro_server.shutdown()
        self.pomodoro_server.server_close()
        self.pomodoro_thread.join(timeout=5)
        self.env.stop()
        pomodoro.DB_FILE = self.original_db
        pomodoro.AURACARDS_API_URL = self.original_auracards_api_url
        self.temp.cleanup()

    def request_json(self, url, token=None):
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = Request(url, headers=headers)
        try:
            with self.client.open(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except HTTPError as response:
            with response:
                return response.code, json.loads(response.read())

    def test_pomodoro_health_check(self):
        status, payload = self.request_json(self.pomodoro_url + "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"status": "ok", "service": "pomodoro"})

    def test_bind_hosts_use_render_interface(self):
        with patch.dict(
            os.environ,
            {
                "RENDER_EXTERNAL_HOSTNAME": "pomodoro.onrender.com",
                "HOST": "127.0.0.1",
            },
        ):
            self.assertEqual(pomodoro.get_bind_host(), "0.0.0.0")
            self.assertEqual(aura_bind_host(), "0.0.0.0")

    def test_each_service_requests_the_other_service_summary(self):
        status, pomodoro_summary = self.request_json(
            self.aura_url + "/api/integrations/pomodoro"
        )
        self.assertEqual(status, 200)
        self.assertEqual(pomodoro_summary["service"], "pomodoro")
        self.assertEqual(pomodoro_summary["today"], {"sessions": 1, "minutes": 42})

        status, aura_summary = self.request_json(
            self.pomodoro_url + "/api/integrations/auracards"
        )
        self.assertEqual(status, 200)
        self.assertEqual(aura_summary["service"], "auracards")
        self.assertEqual(aura_summary["completed_sessions"], 1)
        self.assertEqual(aura_summary["total_minutes"], 1)

    def test_summary_endpoints_require_a_shared_token(self):
        status, response = self.request_json(
            self.aura_url + "/api/integrations/summary"
        )
        self.assertEqual(status, 401)
        self.assertEqual(response["code"], "integration_unauthorized")

        status, response = self.request_json(
            self.pomodoro_url + "/api/integrations/summary"
        )
        self.assertEqual(status, 401)
        self.assertFalse(response["success"])

        status, aura_summary = self.request_json(
            self.aura_url + "/api/integrations/summary",
            TOKEN,
        )
        self.assertEqual(status, 200)
        self.assertEqual(aura_summary["total_minutes"], 1)
        self.assertNotIn("sessions", aura_summary)
        self.assertNotIn("deck_id", aura_summary)

        status, pomo_summary = self.request_json(
            self.pomodoro_url + "/api/integrations/summary",
            TOKEN,
        )
        self.assertEqual(status, 200)
        self.assertEqual(pomo_summary["all_time"], {"sessions": 1, "minutes": 42})
        self.assertNotIn("notes", pomo_summary)
        self.assertNotIn("tasks", pomo_summary)

    def test_unavailable_remote_service_returns_json_503(self):
        self.aura_app.config["POMODORO_API_URL"] = (
            "http://127.0.0.1:1"
        )
        status, response = self.request_json(
            self.aura_url + "/api/integrations/pomodoro"
        )
        self.assertEqual(status, 503)
        self.assertEqual(response["code"], "pomodoro_unavailable")

    def test_frame_policy_allows_only_configured_origin_for_aura_page(self):
        client = self.aura_app.test_client()
        response = client.get("/", buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("X-Frame-Options", response.headers)
        self.assertIn(
            "frame-ancestors http://127.0.0.1:5001",
            response.headers["Content-Security-Policy"],
        )
        response.close()

        api_response = client.get("/api/health")
        self.assertEqual(api_response.headers["X-Frame-Options"], "DENY")
        self.assertIn(
            "frame-ancestors 'none'",
            api_response.headers["Content-Security-Policy"],
        )
        api_response.close()

        unframed_app = create_app({
            "TESTING": True,
            "DATA_DIR": str(self.directory / "unframed-aura-data"),
            "SECRET_KEY": "unframed-test-secret",
            "AURA_FRAME_ORIGINS": "",
        })
        unframed_response = unframed_app.test_client().get("/", buffered=True)
        self.assertEqual(unframed_response.headers["X-Frame-Options"], "DENY")
        self.assertIn(
            "frame-ancestors 'none'",
            unframed_response.headers["Content-Security-Policy"],
        )
        unframed_response.close()


if __name__ == "__main__":
    unittest.main()
