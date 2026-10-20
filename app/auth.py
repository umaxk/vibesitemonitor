import hmac
import os
import secrets
import time

from fastapi import Request

from app import config as app_config

PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
SESSION_COOKIE = "session"
SESSION_TTL_SECONDS = int(
    os.environ.get("MONITOR_SESSION_TTL_SECONDS", str(7 * 24 * 3600))
)
LOGIN_WINDOW_SECONDS = 60
LOGIN_MAX_ATTEMPTS = 10

_active_tokens: dict[str, float] = {}
_login_attempts: dict[str, list[float]] = {}


def _normalize_tokens(raw) -> list[dict]:
    now = time.time()
    tokens = []
    if not isinstance(raw, list):
        return tokens
    for item in raw:
        if isinstance(item, str):
            tokens.append({"token": item, "expires": now + SESSION_TTL_SECONDS})
        elif isinstance(item, dict) and isinstance(item.get("token"), str):
            expires = item.get("expires")
            if not isinstance(expires, (int, float)):
                expires = now + SESSION_TTL_SECONDS
            tokens.append({"token": item["token"], "expires": float(expires)})
    return tokens


def _load_tokens() -> None:
    cfg = app_config.load_config()
    raw = cfg.get("session_tokens", [])
    normalized = _normalize_tokens(raw)
    now = time.time()
    valid = {
        item["token"]: item["expires"]
        for item in normalized
        if item["expires"] > now
    }
    _active_tokens.clear()
    _active_tokens.update(valid)
    if normalized != raw:
        cfg["session_tokens"] = [
            {"token": token, "expires": expires} for token, expires in valid.items()
        ]
        app_config.save_config(cfg)


def _persist_tokens() -> None:
    cfg = app_config.load_config()
    cfg["session_tokens"] = [
        {"token": token, "expires": expires}
        for token, expires in _active_tokens.items()
    ]
    app_config.save_config(cfg)


_load_tokens()


def verify_password(password: str) -> bool:
    if not PASSWORD:
        return False
    return hmac.compare_digest(password.encode(), PASSWORD.encode())


def login_allowed(client_ip: str) -> bool:
    now = time.time()
    attempts = [
        ts for ts in _login_attempts.get(client_ip, []) if now - ts < LOGIN_WINDOW_SECONDS
    ]
    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        _login_attempts[client_ip] = attempts
        return False
    attempts.append(now)
    _login_attempts[client_ip] = attempts
    return True


def clear_login_attempts(client_ip: str) -> None:
    _login_attempts.pop(client_ip, None)


def create_session_token() -> str:
    token = secrets.token_urlsafe(32)
    expires = time.time() + SESSION_TTL_SECONDS
    _active_tokens[token] = expires
    _persist_tokens()
    return token


def revoke_session_token(token: str | None) -> None:
    if not token:
        return
    _active_tokens.pop(token, None)
    _persist_tokens()


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    if _active_tokens.get(token, 0) > time.time():
        return True
    _load_tokens()
    return _active_tokens.get(token, 0) > time.time()
