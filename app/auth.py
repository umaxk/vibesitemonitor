import hashlib
import hmac
import os
import secrets

from fastapi import Request

from app import config as app_config

PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
SESSION_COOKIE = "session"

_active_tokens: set[str] = set()


def _load_tokens():
    cfg = app_config.load_config()
    for token in cfg.get("session_tokens", []):
        _active_tokens.add(token)


_load_tokens()


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str) -> bool:
    if not PASSWORD:
        return False
    return hmac.compare_digest(_hash_password(password), _hash_password(PASSWORD))


def create_session_token() -> str:
    token = secrets.token_urlsafe(32)
    _active_tokens.add(token)
    cfg = app_config.load_config()
    tokens = cfg.get("session_tokens", [])
    tokens.append(token)
    cfg["session_tokens"] = tokens
    app_config.save_config(cfg)
    return token


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    if token in _active_tokens:
        return True
    _load_tokens()
    return token in _active_tokens
