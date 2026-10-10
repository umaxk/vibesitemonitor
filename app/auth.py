import hashlib
import hmac
import os
import secrets

from fastapi import Request

PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
SESSION_COOKIE = "session"

_active_tokens: set[str] = set()


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str) -> bool:
    if not PASSWORD:
        return False
    return hmac.compare_digest(_hash_password(password), _hash_password(PASSWORD))


def create_session_token() -> str:
    token = secrets.token_urlsafe(32)
    _active_tokens.add(token)
    return token


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    return token in _active_tokens
