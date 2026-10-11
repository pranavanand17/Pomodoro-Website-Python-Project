from http.server import SimpleHTTPRequestHandler, HTTPServer
import json
from datetime import datetime
import os

HOST = "localhost"
PORT = 8000
DATA_FILE = "study_data.json"


def load_data():
    if not os.path.exists(DATA_FILE):
        return {"sessions": []}

    try:
        with open(DATA_FILE, "r") as file:
            return json.load(file)
    except (json.JSONDecodeError, FileNotFoundError):
        return {"sessions": []}


def save_data(data):
    with open(DATA_FILE, "w") as file:
        json.dump(data, file, indent=2)


class PomodoroHandler(SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/api/stats":
            self.send_stats()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/session":
            self.save_session()
        else:
            self.send_error(404, "Not Found")

    def save_session(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            request_data = json.loads(body)

            duration = request_data.get("duration", 25)

            data = load_data()

            session = {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "time": datetime.now().strftime("%H:%M"),
                "duration": duration
            }

            data["sessions"].append(session)
            save_data(data)

            self.send_json({
                "success": True,
                "session": session
            })

        except Exception as error:
            self.send_json({
                "success": False,
                "error": str(error)
            }, status=500)

    def send_stats(self):
        data = load_data()

        sessions = data.get("sessions", [])

        today = datetime.now().strftime("%Y-%m-%d")

        today_sessions = [
            session
            for session in sessions
            if session["date"] == today
        ]

        today_minutes = sum(
            session["duration"]
            for session in today_sessions
        )

        total_minutes = sum(
            session["duration"]
            for session in sessions
        )

        self.send_json({
            "sessions": sessions,
            "today": {
                "minutes": today_minutes,
                "sessions": len(today_sessions)
            },
            "all_time": {
                "minutes": total_minutes,
                "sessions": len(sessions)
            }
        })

    def send_json(self, data, status=200):
        response = json.dumps(data).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        self.wfile.write(response)


server = HTTPServer((HOST, PORT), PomodoroHandler)

print(f"Server running at http://{HOST}:{PORT}")
print("Press Ctrl+C to stop the server.")

server.serve_forever()
