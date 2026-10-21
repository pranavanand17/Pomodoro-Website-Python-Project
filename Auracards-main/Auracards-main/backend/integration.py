"""Authenticated HTTP client for the Pomodoro progress integration."""

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener


class IntegrationError(Exception):
    """Raised when the configured Pomodoro service is unavailable."""


def service_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise IntegrationError("The configured service URL is invalid.")

    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as error:
        raise IntegrationError("The configured service URL is invalid.") from error

    if (
        parsed.scheme not in ("http", "https")
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise IntegrationError("The configured service URL is invalid.")

    is_loopback = hostname.lower() in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme == "http" and not is_loopback:
        raise IntegrationError("External integration URLs must use HTTPS.")

    return value.rstrip("/")


def fetch_summary(base_url, token):
    if not isinstance(token, str) or len(token) < 32:
        raise IntegrationError("The integration token is not configured.")

    base = service_url(base_url)
    request = Request(
        f"{base}/api/integrations/summary",
        headers={
            "Accept": "application/json",
            "Authorization": "Bearer " + token,
        },
    )

    try:
        with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
            if response.status != 200:
                raise IntegrationError("The Pomodoro service returned an error.")
            if "application/json" not in response.headers.get("Content-Type", ""):
                raise IntegrationError("The Pomodoro service returned invalid data.")
            payload = response.read(16_385)
    except HTTPError as error:
        raise IntegrationError(
            f"The Pomodoro service returned HTTP {error.code}."
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise IntegrationError("The Pomodoro service is unavailable.") from error

    if len(payload) > 16_384:
        raise IntegrationError("The Pomodoro service response is too large.")

    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IntegrationError("The Pomodoro service returned invalid JSON.") from error

    if not isinstance(data, dict) or data.get("service") != "pomodoro":
        raise IntegrationError("The Pomodoro service returned an unexpected response.")

    summary = {}
    for period in ("today", "all_time"):
        values = data.get(period)
        if (
            not isinstance(values, dict)
            or not _is_nonnegative_int(values.get("sessions"))
            or not _is_nonnegative_int(values.get("minutes"))
        ):
            raise IntegrationError("The Pomodoro service returned invalid summary data.")
        summary[period] = {
            "sessions": values["sessions"],
            "minutes": values["minutes"],
        }

    return {"service": "pomodoro", **summary}


def _is_nonnegative_int(value):
    return type(value) is int and value >= 0
