"""Aura Cards local Flask API and frontend server. Run python app.py."""
from collections import defaultdict, deque, Counter
from datetime import timedelta
from io import BytesIO
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit
from flask import Flask, Request, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from backend.errors import UserError
from backend.extraction import MAX_FILE_BYTES, extract_isolated
from backend.focus import FocusStore
from backend.integration import IntegrationError, fetch_summary, service_url
from backend.generation import extractive, extractive_details, ollama, ollama_status, _local_base
from backend.cloud import generate as cloud_generate

ROOT = Path(__file__).resolve().parent


class MemoryRequest(Request):
    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return BytesIO()


def origin_of(value):
    if not isinstance(value, str):
        raise UserError("Enter a valid timer URL.", 400, "invalid_timer")
    try:
        url = urlsplit(value)
        _ = url.port
    except ValueError as exc:
        raise UserError("Enter a valid timer URL.", 400, "invalid_timer") from exc
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise UserError("Enter a valid timer URL.", 400, "invalid_timer")
    if url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise UserError("Use HTTPS for an external timer.", 400, "invalid_timer")
    return f"{url.scheme}://{url.netloc}"


def configured_frame_origins(value):
    if isinstance(value, str):
        values = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        values = value
    else:
        raise ValueError("AURA_FRAME_ORIGINS must be a list of web origins.")

    origins = []
    for item in values:
        if not isinstance(item, str) or not item.strip():
            continue
        item = item.strip()
        try:
            parsed = urlsplit(item)
            origin = origin_of(item)
        except (ValueError, UserError) as error:
            raise ValueError("AURA_FRAME_ORIGINS contains an invalid origin.") from error
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("AURA_FRAME_ORIGINS accepts origins, not paths.")
        origins.append(origin)
    return tuple(dict.fromkeys(origins))


def create_app(config=None):
    app = Flask(__name__, static_folder=str(ROOT / "dist"), static_url_path="")
    app.request_class = MemoryRequest
    trusted_hosts = {"localhost", "127.0.0.1", "[::1]"}
    trusted_hosts.update(
        host.strip()
        for host in os.environ.get("AURA_TRUSTED_HOSTS", "").split(",")
        if host.strip()
    )
    render_hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    if render_hostname:
        trusted_hosts.add(render_hostname)
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_FILE_BYTES + 1024 * 1024,
        MAX_FORM_MEMORY_SIZE=256 * 1024, MAX_FORM_PARTS=12,
        SESSION_COOKIE_NAME="aura_device", SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "").lower() in ("1", "true", "yes"),
        PERMANENT_SESSION_LIFETIME=timedelta(days=90),
        DATA_DIR=os.environ.get("AURA_DATA_DIR", str(ROOT / ".aura-data")),
        OLLAMA_URL=os.environ.get("AURA_OLLAMA_URL", "http://127.0.0.1:11434"),
        OLLAMA_MODEL=os.environ.get("AURA_OLLAMA_MODEL", "llama3.2:3b"),
        OPENAI_API_KEY=os.environ.get("OPENAI_API_KEY", ""),
        CLOUD_MODEL=os.environ.get("AURA_CLOUD_MODEL", "gpt-4.1-mini"),
        POMODORO_URL=os.environ.get(
            "POMODORO_URL",
            "http://127.0.0.1:5001"
        ),
        POMODORO_API_URL=os.environ.get(
            "POMODORO_API_URL",
            "http://127.0.0.1:5001"
        ),
        STUDY_INTEGRATION_TOKEN=os.environ.get("STUDY_INTEGRATION_TOKEN", ""),
        AURA_FRAME_ORIGINS=os.environ.get("AURA_FRAME_ORIGINS", ""),
        EXTRACTOR=extract_isolated, FOCUS_CLOCK=time.time,
        ALLOWED_ORIGINS=set(filter(None, os.environ.get("AURA_ALLOWED_ORIGINS", "").split(","))),
        TRUSTED_HOSTS=sorted(trusted_hosts),
    )
    if config:
        app.config.update(config)
    app.config["AURA_FRAME_ORIGINS"] = configured_frame_origins(
        app.config["AURA_FRAME_ORIGINS"]
    )
    _local_base(app.config["OLLAMA_URL"])
    data_dir = Path(app.config["DATA_DIR"])
    data_dir.mkdir(parents=True, exist_ok=True)
    data_dir.chmod(0o700)
    secret = data_dir / "session-secret"
    if not app.config.get("SECRET_KEY"):
        try:
            with secret.open("x") as stream:
                stream.write(secrets.token_hex(32))
            secret.chmod(0o600)
        except FileExistsError:
            pass
        app.config["SECRET_KEY"] = secret.read_text().strip()
    store = FocusStore(data_dir / "focus.sqlite3", app.config["FOCUS_CLOCK"])
    app.extensions["focus_store"] = store
    generation_lock = threading.BoundedSemaphore(1)
    rate_lock, rates = threading.Lock(), defaultdict(deque)

    def device():
        session.permanent = True
        if "device" not in session:
            session["device"] = secrets.token_urlsafe(24)
        return session["device"]

    def same_origin():
        return request.headers.get("Origin") in (None, request.host_url.rstrip("/"))

    def csrf():
        origin = request.headers.get("Origin")
        if not same_origin() and origin not in app.config["ALLOWED_ORIGINS"]:
            raise UserError("This origin is not authorized.", 403, "origin_blocked")
        expected, received = session.get("csrf"), request.headers.get("X-Aura-CSRF", "")
        if not expected or not secrets.compare_digest(expected, received):
            raise UserError("Refresh the page to reconnect to the local API.", 403, "csrf_required")

    def limited():
        key, now = device(), time.monotonic()
        with rate_lock:
            times = rates[key]
            while times and times[0] < now - 60:
                times.popleft()
            if len(times) >= 6:
                raise UserError("Please wait a minute before generating more decks.", 429, "rate_limited")
            times.append(now)
            if len(rates) > 1000:
                for old in list(rates):
                    if not rates[old] or rates[old][-1] < now - 60:
                        del rates[old]

    def bearer():
        value = request.headers.get("Authorization", "")
        if not value.startswith("Bearer ") or len(value) > 200:
            raise UserError("A session token is required.", 401, "unauthorized_session")
        return value[7:]

    def integration_authorized():
        token = app.config["STUDY_INTEGRATION_TOKEN"]
        if not isinstance(token, str) or len(token) < 32:
            raise UserError(
                "The service integration is not configured.",
                503,
                "integration_not_configured",
            )
        supplied = request.headers.get("Authorization", "")
        if not secrets.compare_digest(supplied, f"Bearer {token}"):
            raise UserError(
                "A valid integration token is required.",
                401,
                "integration_unauthorized",
            )

    @app.before_request
    def preflight():
        if request.method != "OPTIONS":
            return None
        origin = request.headers.get("Origin", "")
        if request.path.startswith("/api/focus-sessions/"):
            # The actual request checks the Bearer token and its per-session origin.
            response = app.make_response(("", 204))
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            return response
        if origin == request.host_url.rstrip("/") or origin in app.config["ALLOWED_ORIGINS"]:
            return ("", 204)
        raise UserError("This origin is not authorized.", 403, "origin_blocked")

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        frame_document = request.path in ("/", "/index.html")
        frame_origins = app.config["AURA_FRAME_ORIGINS"]
        if frame_document and frame_origins:
            response.headers.pop("X-Frame-Options", None)
            ancestors = " ".join(frame_origins)
        else:
            response.headers["X-Frame-Options"] = "DENY"
            ancestors = "'none'"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self' http://localhost:* "
            "http://127.0.0.1:* https:; object-src 'none'; base-uri 'self'; "
            f"frame-ancestors {ancestors}"
        )
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        origin = request.headers.get("Origin")
        if origin and origin in app.config["ALLOWED_ORIGINS"]:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "X-Aura-CSRF, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        elif origin and request.path.startswith("/api/focus-sessions/") and response.status_code < 400:
            response.headers["Access-Control-Allow-Origin"] = origin
        if origin:
            response.headers.add("Vary", "Origin")
        return response

    @app.errorhandler(UserError)
    def known_error(error):
        return jsonify(error=str(error), code=error.code), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        messages = {413: "Choose a document no larger than 20 MB.", 404: "This page or API route does not exist.", 400: "The request could not be read.", 405: "This request method is not supported."}
        return jsonify(error=messages.get(error.code, "The request was rejected."), code="http_error"), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        # Avoid exception messages/tracebacks: parsers may include study content.
        app.logger.error("Request failed with %s", type(error).__name__)
        return jsonify(error="The server could not finish this request. Try again.", code="server_error"), 500

    @app.get("/")
    def home():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/pomodoro")
    def timer():
        return send_from_directory(app.static_folder, "pomodoro.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", app="Aura Cards", version="2.2.0")

    @app.get("/api/config")
    def api_config():
        if not same_origin() and request.headers.get("Origin") not in app.config["ALLOWED_ORIGINS"]:
            raise UserError("This origin is not authorized.", 403, "origin_blocked")
        device()
        session.setdefault("csrf", secrets.token_urlsafe(32))
        return jsonify(csrf_token=session["csrf"], generators=["extractive", "cloud", "ollama"],
                       max_file_mb=20, ollama_model=app.config["OLLAMA_MODEL"],
                       timer_url=service_url(app.config["POMODORO_URL"]),
                       cloud={"configured": bool(app.config["OPENAI_API_KEY"].strip()), "provider": "OpenAI", "model": app.config["CLOUD_MODEL"]})

    @app.get("/api/integrations/summary")
    def integration_summary():
        integration_authorized()
        return jsonify({"success": True, **store.integration_summary()})

    @app.get("/api/integrations/pomodoro")
    def pomodoro_summary():
        try:
            summary = fetch_summary(
                app.config["POMODORO_API_URL"],
                app.config["STUDY_INTEGRATION_TOKEN"],
            )
        except IntegrationError as error:
            raise UserError(
                str(error),
                503,
                "pomodoro_unavailable",
            ) from error
        return jsonify({"success": True, **summary})

    @app.get("/api/models/status")
    def model_status():
        return jsonify(ollama_status(app.config["OLLAMA_URL"], app.config["OLLAMA_MODEL"]))

    @app.post("/api/generate")
    def generate():
        csrf()
        limited()
        file = request.files.get("file")
        if not file or not file.filename:
            raise UserError("Choose a document first.", 400, "missing_file")
        name, category = request.form.get("name", "").strip(), request.form.get("category", "").strip()
        if not 1 <= len(name) <= 100 or not 1 <= len(category) <= 100:
            raise UserError("Enter a deck name and category of up to 100 characters.", 400, "invalid_fields")
        try:
            count = int(request.form.get("count", "20"))
        except ValueError as exc:
            raise UserError("Card count must be a number from 1 to 50.", 400, "invalid_count") from exc
        if not 1 <= count <= 50:
            raise UserError("Card count must be between 1 and 50.", 400, "invalid_count")
        difficulty, engine = request.form.get("difficulty", "mixed"), request.form.get("engine", "extractive")
        style, focus = request.form.get("style", "mixed"), request.form.get("focus", "").strip()
        input_format = request.form.get('input_format', 'auto')
        if difficulty not in ("mixed", "beginner", "intermediate", "advanced") or engine not in ("extractive", "cloud", "ollama") or style not in ("mixed", "qa", "cloze"):
            raise UserError("Choose a valid difficulty and generator.", 400, "invalid_options")
        if input_format not in ('auto','qa','topics','prose'):
            raise UserError('Choose a valid document format.',400,'invalid_options')
        if engine!='extractive' and input_format!='auto':
            raise UserError('Choose Offline generation to use a specific document format.',400,'invalid_options')
        if len(focus) > 160:
            raise UserError("Keep the topic focus under 160 characters.", 400, "invalid_fields")
        if engine == "cloud":
            if request.form.get("cloud_consent") != "yes":
                raise UserError("Confirm sending document text to OpenAI before using Cloud AI.", 400, "cloud_consent_required")
            if not app.config["OPENAI_API_KEY"].strip():
                raise UserError("Set OPENAI_API_KEY on the server to use Cloud AI, or choose Offline.", 503, "cloud_not_configured")
        if not generation_lock.acquire(blocking=False):
            raise UserError("Another document is processing. Try again shortly.", 429, "server_busy")
        try:
            raw = file.stream.read(MAX_FILE_BYTES + 1)
            document = app.config["EXTRACTOR"](raw, file.filename)
            warnings = list(document.warnings)
            details = {}
            if engine == "ollama":
                cards, extra = ollama(document, count, difficulty, app.config["OLLAMA_URL"], app.config["OLLAMA_MODEL"], style, focus)
                warnings.extend(extra)
            elif engine == "cloud":
                cards, extra = cloud_generate(document, count, difficulty, app.config["OPENAI_API_KEY"], app.config["CLOUD_MODEL"], style, focus)
                warnings.extend(extra)
            else:
                cards, extra, details = extractive_details(document, count, difficulty, style, focus, input_format)
                warnings.extend(extra)
            if len(cards) < count:
                warnings.append(f"Created {len(cards)} supported cards instead of {count}; the source contained fewer usable facts.")
            return jsonify(cards=cards, engine=engine, requested_count=count, generated_count=len(cards), warnings=warnings,
                           card_types=dict(Counter(c.get('kind', 'fact') for c in cards)), **details)
        finally:
            generation_lock.release()
            file.close()

    @app.route("/api/focus-sessions", methods=["GET", "POST", "DELETE"])
    def focus_sessions():
        if request.method == "GET":
            return jsonify(store.summary(device()))
        csrf()
        if request.method == "DELETE":
            store.clear(device())
            return jsonify(status="cleared")
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            raise UserError("Send a valid JSON object.", 400, "invalid_json")
        timer_origin = origin_of(data.get("timer_url", request.host_url))
        return jsonify(store.create(device(), data.get("deck_id"), data.get("duration_minutes", 25), timer_origin)), 201

    @app.route("/api/focus-sessions/<sid>", methods=["GET", "POST"])
    def focus_control(sid):
        token, origin = bearer(), request.headers.get("Origin")
        if request.method == "GET":
            return jsonify(store.get(sid, token, origin))
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            raise UserError("Send a valid JSON object.", 400, "invalid_json")
        return jsonify(store.control(sid, token, data.get("action"), origin))

    return app


if __name__ == "__main__":
    from waitress import serve
    import argparse
    parser = argparse.ArgumentParser(description="Run Aura Cards locally")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", os.environ.get("AURA_PORT", "5000")))
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a port between 1024 and 65535.")
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"Aura Cards -> http://{host}:{args.port}", flush=True)
    print("Press Ctrl+C to stop. Offline generation is local; Cloud AI is opt-in.", flush=True)
    serve(create_app(), host=host, port=args.port, threads=4, max_request_body_size=MAX_FILE_BYTES + 1024 * 1024, inbuf_overflow=MAX_FILE_BYTES + 2 * 1024 * 1024)
