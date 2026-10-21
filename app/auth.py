import hashlib
import logging
import os
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
from fastapi import Request

from app import repository

logger = logging.getLogger("auth")

SESSION_COOKIE = "session"
SESSION_TTL_SECONDS = int(
    os.environ.get("MONITOR_SESSION_TTL_SECONDS", str(7 * 24 * 3600))
)
LOGIN_WINDOW_SECONDS = 60
LOGIN_MAX_ATTEMPTS = 10
LOGIN_MAX_ATTEMPTS_PER_USER = 5

_hasher = PasswordHasher()
_login_attempts: dict[str, list[float]] = {}
_failed_logins_by_user: dict[str, list[float]] = {}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash, ValueError):
        return False


def authenticate(username: str, password: str):
    user = repository.get_user_by_username(username)
    if not user:
        return None
    if not verify_password(user["password_hash"], password):
        return None
    return user


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    repository.create_session(
        _token_hash(token), user_id, time.time() + SESSION_TTL_SECONDS
    )
    return token


def revoke_session(token: str | None) -> None:
    if not token:
        return
    repository.delete_session(_token_hash(token))


def get_session_user(token: str | None):
    if not token:
        return None
    return repository.get_session(_token_hash(token))


def current_user(request: Request):
    return get_session_user(request.cookies.get(SESSION_COOKIE))


def login_allowed(client_ip: str, username: str | None = None) -> bool:
    now = time.time()
    ip_attempts = [
        ts
        for ts in _login_attempts.get(client_ip, [])
        if now - ts < LOGIN_WINDOW_SECONDS
    ]
    if len(ip_attempts) >= LOGIN_MAX_ATTEMPTS:
        _login_attempts[client_ip] = ip_attempts
        return False
    ip_attempts.append(now)
    _login_attempts[client_ip] = ip_attempts
    if username:
        user_attempts = [
            ts
            for ts in _failed_logins_by_user.get(username, [])
            if now - ts < LOGIN_WINDOW_SECONDS
        ]
        if len(user_attempts) >= LOGIN_MAX_ATTEMPTS_PER_USER:
            _failed_logins_by_user[username] = user_attempts
            return False
    return True


def record_failed_login(username: str) -> None:
    now = time.time()
    attempts = [
        ts
        for ts in _failed_logins_by_user.get(username, [])
        if now - ts < LOGIN_WINDOW_SECONDS
    ]
    attempts.append(now)
    _failed_logins_by_user[username] = attempts


def clear_failed_logins(username: str) -> None:
    _failed_logins_by_user.pop(username, None)


def clear_login_attempts(client_ip: str) -> None:
    _login_attempts.pop(client_ip, None)


def bootstrap_admin() -> None:
    if repository.count_users() > 0:
        return
    username = os.environ.get("MONITOR_ADMIN_USERNAME", "admin").strip() or "admin"
    password = os.environ.get("MONITOR_ADMIN_PASSWORD") or os.environ.get(
        "MONITOR_PASSWORD", ""
    )
    if not password:
        logger.warning(
            "No users exist and MONITOR_PASSWORD is not set; "
            "set it and restart to create the initial admin"
        )
        return
    repository.create_user(username, hash_password(password), "admin")
    logger.info("Created initial admin user %s", username)
