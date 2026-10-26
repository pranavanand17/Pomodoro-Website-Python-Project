"""Aura Cards Flask API and frontend server for local use or Render.

Run: python app.py
Render sets PORT and RENDER_EXTERNAL_HOSTNAME automatically.
Optional: AURA_TRUSTED_HOSTS for custom hostnames (comma-separated, no URLs),
AURA_SECRET_KEY for a stable session signing key, AURA_DATA_DIR for server data.
Set AURA_FRAME_ORIGINS to the exact Pomodoro HTTPS origin to allow its iframe.
"""
from collections import defaultdict, deque, Counter
import hmac
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
from backend.generation_stream import stream_generation
from backend.generation import extractive, extractive_details, ollama, ollama_status, _local_base
from backend.cloud import generate as cloud_generate
from backend.llamacpp import discover as llama_discover, generate_details as llama_generate, local_base as llama_base

ROOT = Path(__file__).resolve().parent


def render_deployment():
    return (os.environ.get("RENDER", "").lower() == "true"
            or bool(os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()))


def deployment_hosts():
    # Keep explicit host validation; never trust every onrender.com service.
    hosts = ["localhost", "127.0.0.1", "[::1]"]
    render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
    if render_host:
        hosts.append(render_host)
    hosts.extend(host.strip() for host in
                 os.environ.get("AURA_TRUSTED_HOSTS", "").split(",") if host.strip())
    return list(dict.fromkeys(hosts))


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


def create_app(config=None):
    app = Flask(__name__, static_folder=str(ROOT / "dist"), static_url_path="")
    app.request_class = MemoryRequest
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_FILE_BYTES + 1024 * 1024,
        MAX_FORM_MEMORY_SIZE=256 * 1024, MAX_FORM_PARTS=16,
        SESSION_COOKIE_NAME="aura_device", SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict", SESSION_COOKIE_SECURE=render_deployment(),
        RENDER_DEPLOYMENT=render_deployment(),
        SECRET_KEY=os.environ.get("AURA_SECRET_KEY") or os.environ.get("SECRET_KEY") or None,
        PERMANENT_SESSION_LIFETIME=timedelta(days=90),
        DATA_DIR=os.environ.get("AURA_DATA_DIR", str(ROOT / ".aura-data")),
        OLLAMA_URL=os.environ.get("AURA_OLLAMA_URL", "http://127.0.0.1:11434"),
        OLLAMA_MODEL=os.environ.get("AURA_OLLAMA_MODEL", "llama3.2:3b"),
        LLAMA_URL=os.environ.get("AURA_LLAMA_URL", ""),
        LLAMA_MODEL=os.environ.get("AURA_LLAMA_MODEL", ""),
        LLAMA_API_KEY=os.environ.get("AURA_LLAMA_API_KEY", ""),
        OPENAI_API_KEY=os.environ.get("OPENAI_API_KEY", ""),
        CLOUD_MODEL=os.environ.get("AURA_CLOUD_MODEL", "gpt-4.1-mini"),
        EXTRACTOR=extract_isolated, FOCUS_CLOCK=time.time,
        ALLOWED_ORIGINS=set(filter(None, os.environ.get("AURA_ALLOWED_ORIGINS", "").split(","))),
        FRAME_ORIGINS=set(filter(None, os.environ.get("AURA_FRAME_ORIGINS", "").split(","))),
        TRUSTED_HOSTS=deployment_hosts(),
    )
    if config:
        app.config.update(config)
    # Explicit frame opt-in permits a hosted Pomodoro site to embed Aura.
    # SameSite=None is needed for cross-site iframe requests over HTTPS.
    # CSRF tokens and same-origin API checks remain required.
    if app.config["RENDER_DEPLOYMENT"] and app.config["FRAME_ORIGINS"]:
        app.config["SESSION_COOKIE_SAMESITE"] = "None"
        app.config["SESSION_COOKIE_SECURE"] = True
        # Isolate iframe sessions by top-level site in browsers supporting CHIPS.
        app.config["SESSION_COOKIE_PARTITIONED"] = True
    _local_base(app.config["OLLAMA_URL"])
    if app.config["LLAMA_URL"]:
        llama_base(app.config["LLAMA_URL"])
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

    def browser_origin():
        # Render serves public HTTPS through its proxy, even when the internal
        # WSGI connection uses HTTP. Use the validated Host and deployment mode,
        # not untrusted X-Forwarded-* headers, for these same-origin checks.
        scheme = "https" if app.config["RENDER_DEPLOYMENT"] else request.scheme
        return f"{scheme}://{request.host}"

    def same_origin():
        return request.headers.get("Origin") in (None, browser_origin())

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
        if origin == browser_origin() or origin in app.config["ALLOWED_ORIGINS"]:
            return ("", 204)
        raise UserError("This origin is not authorized.", 403, "origin_blocked")

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* https:; object-src 'none'; base-uri 'self'"
        frames = app.config["FRAME_ORIGINS"]
        # Only the workspace page is embeddable, and only when the user opts in.
        # API endpoints and every other route remain unframeable.
        if request.path in ("/", "/index.html") and frames:
            def safe_frame(value):
                try:
                    parsed = urlsplit(value)
                    port = parsed.port  # Validate malformed or out-of-range ports.
                    local_http = (parsed.scheme == 'http'
                                  and parsed.hostname in ('localhost', '127.0.0.1')
                                  and port is not None)
                    explicit_https = parsed.scheme == 'https' and bool(parsed.hostname)
                    return ((local_http or explicit_https)
                            and parsed.path in ('', '/')
                            and not any((parsed.username, parsed.password, parsed.query, parsed.fragment))
                            and not any(c.isspace() for c in value)
                            and value.rstrip('/') == f'{parsed.scheme}://{parsed.netloc}')
                except ValueError:
                    return False
            safe_frames = [value for value in sorted(frames) if safe_frame(value)]
            if safe_frames:
                response.headers.pop("X-Frame-Options", None)
                policy += "; frame-ancestors " + " ".join(safe_frames)
            else:
                policy += "; frame-ancestors 'none'"
        else:
            policy += "; frame-ancestors 'none'"
        response.headers["Content-Security-Policy"] = policy
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

    @app.get("/api/integrations/summary")
    def legacy_pomodoro_summary():
        # Legacy Study Space's progress widget only needs aggregate totals.
        # Opt-in via a shared, long-lived token; no deck or study metadata.
        token = os.environ.get("STUDY_INTEGRATION_TOKEN", "")
        provided = request.headers.get("Authorization", "")
        if len(token) < 32 or not hmac.compare_digest(provided, "Bearer " + token):
            raise UserError("Legacy integration token missing or invalid.", 401, "not_authorized")
        import sqlite3
        with sqlite3.connect(str(data_dir / "focus.sqlite3")) as db:
            n, seconds = db.execute(
                "SELECT COUNT(*), COALESCE(SUM(duration),0) FROM focus_sessions WHERE status='completed'"
            ).fetchone()
        return jsonify(service="auracards", completed_sessions=n, total_minutes=seconds // 60)

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", app="Aura Cards", version="2.2.0")

    @app.get("/api/config")
    def api_config():
        if not same_origin() and request.headers.get("Origin") not in app.config["ALLOWED_ORIGINS"]:
            raise UserError("This origin is not authorized.", 403, "origin_blocked")
        device()
        session.setdefault("csrf", secrets.token_urlsafe(32))
        return jsonify(csrf_token=session["csrf"], generators=["extractive", "cloud", "ollama", "llamacpp"],
                       max_file_mb=20, llamacpp={"base_url": app.config["LLAMA_URL"], "model": app.config["LLAMA_MODEL"]}, ollama_model=app.config["OLLAMA_MODEL"], timer_url="/pomodoro",
                       cloud={"configured": bool(app.config["OPENAI_API_KEY"].strip()), "provider": "OpenAI", "model": app.config["CLOUD_MODEL"]})

    @app.get("/api/models/status")
    def model_status():
        return jsonify(ollama_status(app.config["OLLAMA_URL"], app.config["OLLAMA_MODEL"]))

    @app.get("/api/llamacpp/status")
    def llama_status():
        if not same_origin():
            raise UserError("Open Aura locally to detect llama.cpp.", 403, "origin_blocked")
        base = request.args.get('base_url', '').strip() or app.config['LLAMA_URL']
        model = request.args.get('model', '').strip() or app.config['LLAMA_MODEL']
        if len(base)>2000 or len(model)>1024:
            raise UserError('Local model settings are too long.',400,'invalid_fields')
        return jsonify(llama_discover(base, model, app.config['LLAMA_API_KEY']))

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
        if difficulty not in ("mixed", "beginner", "intermediate", "advanced") or engine not in ("extractive", "cloud", "ollama", "llamacpp") or style not in ("mixed", "qa", "cloze"):
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
        depth, detail = request.form.get('generation_depth', 'thorough'), request.form.get('answer_detail', 'expanded')
        if depth not in ('flash', 'balanced', 'thorough') or detail not in ('focused', 'expanded'):
            raise UserError('Choose a valid generation depth and answer detail.', 400, 'invalid_options')
        base = request.form.get('llama_base', '').strip() or app.config['LLAMA_URL']
        model = request.form.get('llama_model', '').strip() or app.config['LLAMA_MODEL']
        if len(base) > 2000 or len(model) > 1024:
            raise UserError('Local model settings are too long.', 400, 'invalid_fields')
        wants_stream = engine == 'llamacpp' and 'application/x-ndjson' in request.headers.get('Accept', '')
        # Copy config before the worker; neither request nor session crosses threads.
        generation_config = {k: app.config[k] for k in ('LLAMA_API_KEY', 'OLLAMA_URL', 'OLLAMA_MODEL', 'OPENAI_API_KEY', 'CLOUD_MODEL')}
        if not generation_lock.acquire(blocking=False):
            raise UserError("Another document is processing. Try again shortly.", 429, "server_busy")
        try:
            raw = file.stream.read(MAX_FILE_BYTES + 1)
            document = app.config["EXTRACTOR"](raw, file.filename)
        except Exception:
            generation_lock.release(); raise
        finally:
            file.close()
        def run_generation(progress=None):
            warnings = list(document.warnings)
            details = {}
            if engine == "llamacpp":
                if progress:
                    progress({'phase': 'connecting', 'message': 'Connecting to your selected local model…', 'accepted': 0, 'requested': count})
                status = llama_discover(base, model, generation_config['LLAMA_API_KEY'])
                cards, extra, report = llama_generate(document, count, difficulty, status, generation_config['LLAMA_API_KEY'], style, focus, depth, detail, progress)
                warnings.extend(extra)
                details.update(local_model=status['model'], generation_report=report)
            elif engine == "ollama":
                cards, extra = ollama(document, count, difficulty, generation_config["OLLAMA_URL"], generation_config["OLLAMA_MODEL"], style, focus)
                warnings.extend(extra)
            elif engine == "cloud":
                cards, extra = cloud_generate(document, count, difficulty, generation_config["OPENAI_API_KEY"], generation_config["CLOUD_MODEL"], style, focus)
                warnings.extend(extra)
            else:
                cards, extra, details = extractive_details(document, count, difficulty, style, focus, input_format)
                warnings.extend(extra)
            if len(cards) < count:
                warnings.append(f"Created {len(cards)} supported cards instead of {count}; see generation notes for local model limits." if engine == "llamacpp" else f"Created {len(cards)} supported cards instead of {count}; the source contained fewer usable facts.")
            return dict(cards=cards, engine=engine, requested_count=count, generated_count=len(cards), warnings=warnings,
                        card_types=dict(Counter(c.get('kind', 'fact') for c in cards)), **details)
        if wants_stream:
            return stream_generation(run_generation, generation_lock.release)
        try:
            return jsonify(run_generation())
        finally:
            generation_lock.release()

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
        timer_origin = origin_of(data.get("timer_url", browser_origin()))
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

    from backend.integration import register
    register(app, device, csrf, data_dir)
    return app


if __name__ == "__main__":
    from waitress import serve
    import argparse
    hosted = render_deployment()
    parser = argparse.ArgumentParser(description="Run Aura Cards locally or on Render")
    default_port = (os.environ.get("PORT", "10000") if hosted
                    else os.environ.get("AURA_PORT", os.environ.get("PORT", "5001")))
    parser.add_argument("--port", type=int, default=default_port,
                        help="Listening port (Render: PORT; local default: 5001)")
    parser.add_argument("--host", default="0.0.0.0" if hosted else "127.0.0.1",
                        help="Listening address (Render: 0.0.0.0; local: 127.0.0.1)")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Choose a port between 1024 and 65535.")
    if hosted:
        public_url = os.environ.get("RENDER_EXTERNAL_URL", "")
        print(f"Aura Cards on Render: {public_url or 'listening on port ' + str(args.port)}", flush=True)
    else:
        print(f"Aura Cards → http://localhost:{args.port}", flush=True)
    print("Press Ctrl+C to stop. Cloud AI is opt-in.", flush=True)
    serve(create_app(), host=args.host, port=args.port, threads=4,
          max_request_body_size=MAX_FILE_BYTES + 1024 * 1024,
          inbuf_overflow=MAX_FILE_BYTES + 2 * 1024 * 1024)
