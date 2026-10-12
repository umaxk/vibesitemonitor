import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app import auth, config as app_config
from app.monitor import monitor

templates = Jinja2Templates(directory="app/templates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    monitor.start()
    yield
    monitor.stop()


app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="static"), name="static")


class SiteCreate(BaseModel):
    url: str = Field(..., pattern=r"^https?://")
    name: str = ""
    check_interval_seconds: int | None = Field(None, ge=5, le=3600)


class SettingsUpdate(BaseModel):
    project_name: str = Field(default="VibeMonitor", min_length=1, max_length=100)
    check_interval_seconds: int = Field(..., ge=5, le=3600)
    timeout_seconds: int = Field(..., ge=1, le=60)
    incident_hide_hours: int = Field(..., ge=1, le=720)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/login")
async def login(request: Request):
    data = await request.json()
    password = data.get("password", "")
    if not auth.verify_password(password):
        raise HTTPException(status_code=401, detail="Invalid password")
    token = auth.create_session_token()
    resp = Response(content='{"ok": true}', media_type="application/json")
    resp.set_cookie(
        key=auth.SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400 * 7,
    )
    return resp


@app.post("/api/logout")
async def logout():
    resp = Response(content='{"ok": true}', media_type="application/json")
    resp.delete_cookie(auth.SESSION_COOKIE)
    return resp


def require_auth(request: Request):
    if not auth.is_authenticated(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/api/sites")
async def get_sites(request: Request):
    require_auth(request)
    cfg = app_config.load_config()
    states = monitor.get_states()
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
    if any(s["url"] == site.url for s in sites):
        raise HTTPException(status_code=409, detail="Site already exists")
    site_data = {"url": site.url, "name": site.name or site.url}
    if site.check_interval_seconds:
        site_data["check_interval_seconds"] = site.check_interval_seconds
    sites.append(site_data)
    cfg["sites"] = sites
    app_config.save_config(cfg)
    return {"ok": True}


@app.delete("/api/sites/{url:path}")
async def delete_site(request: Request, url: str):
    require_auth(request)
    cfg = app_config.load_config()
    sites = cfg.get("sites", [])
    cfg["sites"] = [s for s in sites if s["url"] != url]
    app_config.save_config(cfg)
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
