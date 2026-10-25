"""Request-scoped generation progress. No jobs or document data are persisted."""
import json
from queue import Queue, Empty
import threading
from flask import Response
from .errors import UserError


def stream_generation(run, release):
    events = Queue()
    disconnected = threading.Event()
    def progress(event):
        if disconnected.is_set():
            raise UserError('Generation cancelled because the upload connection closed.', 499, 'generation_cancelled')
        events.put({'type': 'progress', **event})
    def worker():
        try:
            result = run(progress)
            events.put({'type': 'result', 'data': result})
        except UserError as error:
            events.put({'type': 'error', 'error': str(error), 'code': error.code})
        except Exception:
            # Do not expose document text, model output or server internals.
            events.put({'type': 'error', 'error': 'Generation could not finish. Check the local server and try again.', 'code': 'generation_failed'})
        finally:
            release()
            events.put(None)
    def body():
        try:
            while True:
                try:
                    item = events.get(timeout=10)
                except Empty:
                    yield json.dumps({'type': 'heartbeat'}) + '\n'; continue
                if item is None:
                    break
                yield json.dumps(item, ensure_ascii=False) + '\n'
        finally:
            # The in-flight local HTTP call may finish first (at most 150s).
            # Its next stage sees this flag; the semaphore stays held until then.
            disconnected.set()
    thread = threading.Thread(target=worker, daemon=True, name='aura-generation')
    try:
        thread.start()
    except Exception:
        release(); raise
    response = Response(body(), mimetype='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})
    response.call_on_close(disconnected.set)
    return response
