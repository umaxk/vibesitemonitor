import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import AnyHttpUrl, BaseModel, Field

from app import auth, config as app_config
from app.monitor import monitor

BASE_DIR = Path(__file__).resolve().parent.parent
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))

COOKIE_SECURE = os.environ.get("MONITOR_COOKIE_SECURE", "").lower() in {
    "1",
    "true",
    "yes",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


class LoginRequest(BaseModel):
    password: str = Field(..., max_length=256)


class SiteCreate(BaseModel):
    url: AnyHttpUrl
    name: str = Field(default="", max_length=200)
    check_interval_seconds: int | None = Field(None, ge=5, le=3600)


class SettingsUpdate(BaseModel):
    project_name: str = Field(..., min_length=1, max_length=100)
    check_interval_seconds: int = Field(..., ge=5, le=3600)
    timeout_seconds: int = Field(..., ge=1, le=60)
    incident_hide_hours: int = Field(..., ge=1, le=720)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.post("/api/login")
async def login(request: Request, payload: LoginRequest):
    client_ip = request.client.host if request.client else "unknown"
    if not auth.login_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many attempts")
    if not auth.verify_password(payload.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    auth.clear_login_attempts(client_ip)
    token = auth.create_session_token()
    resp = JSONResponse({"ok": True})
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
    auth.revoke_session_token(request.cookies.get(auth.SESSION_COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.SESSION_COOKIE)
    return resp


def require_auth(request: Request):
    if not auth.is_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/api/sites")
async def get_sites(request: Request):
    require_auth(request)
    cfg = app_config.load_config()
    result = []
    for site in cfg.get("sites", []):
        state = monitor.get_state(site["url"])
        result.append(
            {
                "url": site["url"],
                "name": site.get("name", site["url"]),
                "status": state.status if state else "unknown",
                "last_check": state.last_check if state else None,
                "http_code": state.http_code if state else None,
                "latency_ms": state.latency_ms if state else None,
                "error": state.error if state else None,
                "check_interval_seconds": site.get("check_interval_seconds"),
                "last_incident_time": state.last_incident_time if state else None,
            }
        )
    return {
        "sites": result,
        "project_name": cfg.get("project_name", "VibeMonitor"),
        "check_interval_seconds": cfg.get("check_interval_seconds", 60),
        "timeout_seconds": cfg.get("timeout_seconds", 10),
        "incident_hide_hours": cfg.get("incident_hide_hours", 12),
    }


@app.post("/api/sites")
async def add_site(request: Request, site: SiteCreate):
    require_auth(request)
    cfg = app_config.load_config()
    sites = cfg.get("sites", [])
    url = str(site.url)
    if any(s["url"].rstrip("/") == url.rstrip("/") for s in sites):
        raise HTTPException(status_code=409, detail="Site already exists")
    site_data = {"url": url, "name": site.name or url}
    if site.check_interval_seconds:
        site_data["check_interval_seconds"] = site.check_interval_seconds
    sites.append(site_data)
    cfg["sites"] = sites
    app_config.save_config(cfg)
    monitor.wake()
    return {"ok": True}


@app.delete("/api/sites/{url:path}")
async def delete_site(request: Request, url: str):
    require_auth(request)
    cfg = app_config.load_config()
    sites = cfg.get("sites", [])
    cfg["sites"] = [s for s in sites if s["url"] != url]
    app_config.save_config(cfg)
    monitor.wake()
    return {"ok": True}


@app.put("/api/settings")
async def update_settings(request: Request, settings: SettingsUpdate):
    require_auth(request)
    cfg = app_config.load_config()
    cfg["project_name"] = settings.project_name
    cfg["check_interval_seconds"] = settings.check_interval_seconds
    cfg["timeout_seconds"] = settings.timeout_seconds
    cfg["incident_hide_hours"] = settings.incident_hide_hours
    app_config.save_config(cfg)
    monitor.update_settings(settings.check_interval_seconds, settings.timeout_seconds)
    return {"ok": True}


@app.get("/api/history/{url:path}")
async def get_history(request: Request, url: str):
    require_auth(request)
    state = monitor.get_state(url)
    if not state:
        raise HTTPException(status_code=404, detail="Site not found")
    return {
        "url": url,
        "history": [
            {
                "timestamp": h.timestamp,
                "status": h.status,
                "http_code": h.http_code,
                "latency_ms": h.latency_ms,
                "error": h.error,
            }
            for h in reversed(state.history)
        ],
    }
