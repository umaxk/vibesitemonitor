import logging
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import AnyHttpUrl, BaseModel, Field
from sqlite3 import IntegrityError

from app import auth, logging_config, net_guard, notifications, repository
from app.monitor import monitor

logging_config.setup()
logger = logging.getLogger("http")

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

COOKIE_SECURE = os.environ.get("MONITOR_COOKIE_SECURE", "true").lower() in {
    "1",
    "true",
    "yes",
}

CSRF_COOKIE = "csrf_token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _csrf_ok(request: Request) -> bool:
    header_token = request.headers.get("x-csrf-token", "")
    cookie_token = request.cookies.get(CSRF_COOKIE, "")
    if not header_token or not cookie_token:
        return False
    return secrets.compare_digest(header_token, cookie_token)


def _set_csrf_cookie(request: Request, response: Response) -> None:
    if request.cookies.get(CSRF_COOKIE):
        return
    response.set_cookie(
        key=CSRF_COOKIE,
        value=secrets.token_urlsafe(32),
        httponly=False,
        samesite="lax",
        secure=COOKIE_SECURE or request.url.scheme == "https",
        max_age=auth.SESSION_TTL_SECONDS,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    repository.initialize()
    auth.bootstrap_admin()
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    start = time.perf_counter()
    csrf_failed = request.method in UNSAFE_METHODS and not _csrf_ok(request)
    if csrf_failed:
        response = JSONResponse({"detail": "CSRF check failed"}, status_code=403)
    else:
        response = await call_next(request)
    _set_csrf_cookie(request, response)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    if not request.url.path.startswith("/static"):
        duration = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(duration, 1),
                "user": getattr(request.state, "username", None),
            },
        )
    return response


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., max_length=256)


class SiteBase(BaseModel):
    url: AnyHttpUrl
    name: str = Field(default="", max_length=200)
    check_interval_seconds: int | None = Field(None, ge=5, le=3600)
    tags: list[str] = Field(default_factory=list, max_length=10)
    public: bool = False

    def clean_url(self) -> str:
        return str(self.url)


class SettingsUpdate(BaseModel):
    project_name: str = Field(..., min_length=1, max_length=100)
    check_interval_seconds: int = Field(..., ge=5, le=3600)
    timeout_seconds: int = Field(..., ge=1, le=60)
    incident_hide_hours: int = Field(..., ge=1, le=720)
    retention_days: int = Field(..., ge=1, le=365)
    incident_retention_days: int = Field(..., ge=7, le=730)
    status_page_enabled: bool
    status_page_title: str = Field(..., min_length=1, max_length=100)
    status_page_description: str = Field(default="", max_length=500)
    ssl_check_interval_seconds: int = Field(..., ge=3600, le=604800)


class PauseRequest(BaseModel):
    paused: bool


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["admin", "viewer"] = "viewer"


class UserUpdate(BaseModel):
    role: Literal["admin", "viewer"] | None = None
    password: str | None = Field(None, min_length=8, max_length=128)


class RecipientCreate(BaseModel):
    chat_id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(default="", max_length=100)


class RecipientUpdate(BaseModel):
    label: str | None = Field(None, max_length=100)
    enabled: bool | None = None


class IncidentUpdate(BaseModel):
    note: str = Field(default="", max_length=1000)


def require_user(request: Request) -> dict:
    user = auth.current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    request.state.username = user["username"]
    return user


def require_admin(request: Request) -> dict:
    user = require_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _guard_site_url(site: SiteBase) -> str:
    url = net_guard.strip_url_credentials(site.clean_url())
    try:
        net_guard.check_url(url)
    except net_guard.DisallowedHostError:
        raise HTTPException(
            status_code=400,
            detail="URL points to a private or reserved address",
        ) from None
    return url


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/status", response_class=HTMLResponse)
async def status_page(request: Request):
    if not repository.get_settings().get("status_page_enabled"):
        raise HTTPException(status_code=404, detail="Status page is disabled")
    return templates.TemplateResponse("status.html", {"request": request})


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.get("/healthz")
async def healthz():
    settings = repository.get_settings()
    db_ok = repository.health()
    last_loop = monitor.last_loop()
    max_gap = max(120, int(settings.get("check_interval_seconds", 60)) * 3)
    monitor_ok = last_loop is not None and time.time() - last_loop <= max_gap
    healthy = db_ok and monitor_ok
    return JSONResponse({}, status_code=200 if healthy else 503)


@app.post("/api/login")
async def login(request: Request, payload: LoginRequest):
    client_ip = request.client.host if request.client else "unknown"
    username_key = payload.username.strip().lower()
    if not auth.login_allowed(client_ip, username_key):
        raise HTTPException(status_code=429, detail="Too many attempts")
    user = auth.authenticate(payload.username, payload.password)
    if not user:
        auth.record_failed_login(username_key)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    auth.clear_login_attempts(client_ip)
    auth.clear_failed_logins(username_key)
    token = auth.create_session(user["id"])
    resp = JSONResponse(
        {"ok": True, "username": user["username"], "role": user["role"]}
    )
    resp.set_cookie(
        key=auth.SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE or request.url.scheme == "https",
        max_age=auth.SESSION_TTL_SECONDS,
    )
    return resp


@app.post("/api/logout")
async def logout(request: Request):
    auth.revoke_session(request.cookies.get(auth.SESSION_COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.SESSION_COOKIE)
    return resp


@app.post("/api/logout-all")
async def logout_all(request: Request):
    user = require_user(request)
    repository.delete_user_sessions(user["user_id"])
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.SESSION_COOKIE)
    return resp


@app.get("/api/me")
async def me(request: Request):
    user = require_user(request)
    return {
        "id": user["user_id"],
        "username": user["username"],
        "role": user["role"],
    }


@app.get("/api/sites")
async def get_sites(request: Request):
    user = require_user(request)
    settings = repository.get_settings()
    return {
        "sites": repository.list_sites(),
        "role": user["role"],
        "username": user["username"],
        "project_name": settings.get("project_name", "VibeMonitor"),
        "check_interval_seconds": settings.get("check_interval_seconds", 60),
        "timeout_seconds": settings.get("timeout_seconds", 10),
        "incident_hide_hours": settings.get("incident_hide_hours", 12),
    }


@app.post("/api/sites")
async def add_site(request: Request, site: SiteBase):
    require_admin(request)
    url = _guard_site_url(site)
    if repository.find_site_by_url(url):
        raise HTTPException(status_code=409, detail="Site already exists")
    try:
        created = repository.create_site(
            url,
            site.name,
            site.check_interval_seconds,
            site.tags,
            site.public,
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Site already exists") from None
    monitor.site_changed(created["id"])
    return created


@app.get("/api/sites/{site_id}")
async def get_site(request: Request, site_id: int):
    require_user(request)
    site = repository.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


@app.put("/api/sites/{site_id}")
async def update_site(request: Request, site_id: int, site: SiteBase):
    require_admin(request)
    existing = repository.get_site(site_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Site not found")
    url = _guard_site_url(site)
    duplicate = repository.find_site_by_url(url)
    if duplicate and duplicate["id"] != site_id:
        raise HTTPException(status_code=409, detail="Site already exists")
    try:
        updated = repository.update_site(
            site_id,
            url,
            site.name,
            site.check_interval_seconds,
            site.tags,
            site.public,
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Site already exists") from None
    monitor.site_changed(site_id)
    return updated


@app.delete("/api/sites/{site_id}")
async def delete_site(request: Request, site_id: int):
    require_admin(request)
    if not repository.delete_site(site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    monitor.site_removed(site_id)
    return {"ok": True}


@app.post("/api/sites/{site_id}/check")
async def check_site_now(request: Request, site_id: int):
    require_admin(request)
    updated = await monitor.check_now(site_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Site not found")
    return updated


@app.post("/api/sites/{site_id}/pause")
async def pause_site(request: Request, site_id: int, payload: PauseRequest):
    require_admin(request)
    if not repository.get_site(site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    site = repository.set_paused(site_id, payload.paused)
    monitor.site_changed(site_id)
    return site


@app.get("/api/sites/{site_id}/checks")
async def site_checks(request: Request, site_id: int, limit: int = 100):
    require_user(request)
    if not repository.get_site(site_id):
        raise HTTPException(status_code=404, detail="Site not found")
    return {
        "checks": repository.list_checks(
            site_id, max(1, min(limit, 200))
        )
    }


@app.get("/api/sites/{site_id}/stats")
async def site_stats(request: Request, site_id: int, range: str = "24h"):
    require_user(request)
    site = repository.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if range not in repository.RANGES:
        raise HTTPException(status_code=400, detail="Invalid range")
    since = time.time() - repository.RANGES[range][0]
    return {
        "site": site,
        "stats": repository.site_stats(site_id, range),
        "incidents": repository.list_incidents(
            site_id=site_id, limit=50, since=since
        ),
    }


@app.get("/api/incidents")
async def get_incidents(
    request: Request,
    site_id: int | None = None,
    limit: int = 50,
    open_only: bool = False,
):
    require_user(request)
    return {
        "incidents": repository.list_incidents(
            site_id=site_id, limit=max(1, min(limit, 200)), open_only=open_only
        )
    }


@app.post("/api/incidents/{incident_id}/ack")
async def ack_incident(
    request: Request, incident_id: int, payload: IncidentUpdate | None = None
):
    require_admin(request)
    note = payload.note if payload else None
    incident = repository.acknowledge_incident(incident_id, note)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@app.patch("/api/incidents/{incident_id}")
async def update_incident(
    request: Request, incident_id: int, payload: IncidentUpdate
):
    require_admin(request)
    incident = repository.update_incident_note(incident_id, payload.note)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@app.get("/api/settings")
async def get_settings(request: Request):
    require_admin(request)
    return {
        "settings": repository.get_settings(),
        "telegram_configured": notifications.is_configured(),
    }


@app.put("/api/settings")
async def update_settings(request: Request, settings: SettingsUpdate):
    require_admin(request)
    repository.save_settings(settings.model_dump())
    monitor.wake()
    return {"ok": True, "settings": repository.get_settings()}


@app.get("/api/recipients")
async def get_recipients(request: Request):
    require_admin(request)
    return {
        "recipients": repository.list_recipients(),
        "telegram_configured": notifications.is_configured(),
    }


@app.post("/api/recipients")
async def add_recipient(request: Request, payload: RecipientCreate):
    require_admin(request)
    try:
        return repository.create_recipient(
            payload.chat_id.strip(), payload.label.strip()
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Recipient already exists") from None


@app.put("/api/recipients/{recipient_id}")
async def edit_recipient(
    request: Request, recipient_id: int, payload: RecipientUpdate
):
    require_admin(request)
    recipient = repository.update_recipient(
        recipient_id, payload.label, payload.enabled
    )
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return recipient


@app.delete("/api/recipients/{recipient_id}")
async def remove_recipient(request: Request, recipient_id: int):
    require_admin(request)
    if not repository.delete_recipient(recipient_id):
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {"ok": True}


@app.post("/api/notifications/test")
async def test_notifications(request: Request):
    require_admin(request)
    result = await notifications.send_test()
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@app.get("/api/users")
async def get_users(request: Request):
    require_admin(request)
    return {"users": repository.list_users()}


@app.post("/api/users")
async def add_user(request: Request, payload: UserCreate):
    require_admin(request)
    username = payload.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        raise HTTPException(status_code=400, detail="Invalid username")
    if repository.get_user_by_username(username):
        raise HTTPException(status_code=409, detail="User already exists")
    user = repository.create_user(
        username, auth.hash_password(payload.password), payload.role
    )
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
    }


@app.put("/api/users/{user_id}")
async def edit_user(request: Request, user_id: int, payload: UserUpdate):
    require_admin(request)
    user = repository.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role and payload.role != user["role"]:
        if user["role"] == "admin" and repository.count_admins() <= 1:
            raise HTTPException(
                status_code=400, detail="Cannot demote the last admin"
            )
        repository.update_user_role(user_id, payload.role)
    if payload.password:
        repository.update_user_password(
            user_id, auth.hash_password(payload.password)
        )
        repository.delete_user_sessions(user_id)
    updated = repository.get_user(user_id)
    return {
        "id": updated["id"],
        "username": updated["username"],
        "role": updated["role"],
    }


@app.delete("/api/users/{user_id}")
async def remove_user(request: Request, user_id: int):
    admin = require_admin(request)
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = repository.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "admin" and repository.count_admins() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    repository.delete_user(user_id)
    return {"ok": True}


@app.get("/api/public/status")
async def public_status():
    settings = repository.get_settings()
    if not settings.get("status_page_enabled"):
        raise HTTPException(status_code=404, detail="Status page is disabled")
    return repository.list_public_status()
