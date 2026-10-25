"""Loopback-only calls between the two independent local servers."""
import json
import os
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def peer_call(variable, default, path, data=None):
    base = os.environ.get(variable, default).rstrip("/")
    u = urlsplit(base)
    if (u.scheme != "http" or u.hostname not in ("localhost", "127.0.0.1")
            or u.username or u.password or u.path or u.query or u.fragment):
        raise ValueError(variable + " must be an http://127.0.0.1:PORT origin.")
    _ = u.port
    body = json.dumps(data).encode() if data is not None else None
    req = Request(base + path, data=body, headers={"Content-Type": "application/json"})
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(req, timeout=3) as response:
            return json.load(response), response.status
    except HTTPError as error:
        try:
            return json.load(error), error.code
        except ValueError:
            return {"error": "The other app returned an invalid response."}, 502
    except (URLError, TimeoutError, OSError, ValueError):
        return {"error": "Start the other Python server, then retry. Check the port in LINKING.md."}, 503
