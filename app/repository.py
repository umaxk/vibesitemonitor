import json
import logging
import os
import time
from pathlib import Path

from app import db

logger = logging.getLogger("repository")

BASE_DIR = Path(__file__).resolve().parent.parent
LEGACY_CONFIG_PATH = Path(
    os.environ.get("MONITOR_CONFIG_PATH") or (BASE_DIR / "config.json")
)

DEFAULT_SETTINGS = {
    "project_name": "VibeMonitor",
    "check_interval_seconds": 60,
    "timeout_seconds": 10,
    "incident_hide_hours": 12,
    "retention_days": 30,
    "incident_retention_days": 180,
    "status_page_enabled": True,
    "status_page_title": "Статус сервисов",
    "status_page_description": "",
    "ssl_check_interval_seconds": 21600,
}

RANGES = {
    "24h": (86400, 3600),
    "7d": (7 * 86400, 86400),
    "30d": (30 * 86400, 86400),
}


def _decode_tags(value) -> list[str]:
    try:
        tags = json.loads(value or "[]")
        return [str(tag) for tag in tags if str(tag).strip()]
    except (TypeError, ValueError):
        return []


def serialize_site(row) -> dict:
    site = dict(row)
    site["tags"] = _decode_tags(site.get("tags"))
    site["paused"] = bool(site.get("paused"))
    site["public"] = bool(site.get("public"))
    expires = site.get("ssl_expires_at")
    site["ssl_expired"] = bool(expires and expires <= time.time())
    site["status"] = site.get("last_status")
    site.pop("ssl_alerted", None)
    return site


def _encode_tags(tags: list[str] | None) -> str:
    cleaned = []
    for tag in tags or []:
        value = str(tag).strip()
        if value and value not in cleaned:
            cleaned.append(value[:30])
    return json.dumps(cleaned[:10], ensure_ascii=False)


def _defaults() -> dict:
    return dict(DEFAULT_SETTINGS)


def get_settings() -> dict:
    settings = _defaults()
    for row in db.query_all("SELECT key, value FROM settings"):
        key = row["key"]
        if key.startswith("_"):
            continue
        try:
            settings[key] = json.loads(row["value"])
        except (TypeError, ValueError):
            continue
    return settings


def save_settings(values: dict) -> dict:
    with db.transaction() as conn:
        for key, value in values.items():
            if key.startswith("_"):
                continue
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value, ensure_ascii=False)),
            )
    return get_settings()


def _set_internal_setting(key: str, value) -> None:
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value, ensure_ascii=False)),
        )


def _get_internal_setting(key: str, default=None):
    row = db.query_one("SELECT value FROM settings WHERE key=?", (key,))
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


def _import_legacy_config() -> None:
    if _get_internal_setting("_legacy_imported"):
        return
    if db.query_one("SELECT COUNT(*) AS n FROM sites")["n"]:
        _set_internal_setting("_legacy_imported", True)
        return
    if not LEGACY_CONFIG_PATH.exists():
        return
    try:
        with open(LEGACY_CONFIG_PATH, "r", encoding="utf-8") as f:
            legacy = json.load(f)
    except (OSError, ValueError):
        return
    settings = {}
    for key in (
        "project_name",
        "check_interval_seconds",
        "timeout_seconds",
        "incident_hide_hours",
    ):
        if key in legacy:
            settings[key] = legacy[key]
    if settings:
        save_settings(settings)
    now = time.time()
    with db.transaction() as conn:
        for site in legacy.get("sites", []):
            url = str(site.get("url", "")).strip()
            if not url:
                continue
            conn.execute(
                "INSERT OR IGNORE INTO sites "
                "(url, name, check_interval_seconds, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    url,
                    site.get("name") or url,
                    site.get("check_interval_seconds"),
                    now,
                    now,
                ),
            )
    _set_internal_setting("_legacy_imported", True)
    logger.info("Imported legacy config from %s", LEGACY_CONFIG_PATH)


def _ensure_default_settings() -> None:
    with db.transaction() as conn:
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )


def initialize() -> None:
    db.init_db()
    _import_legacy_config()
    _ensure_default_settings()


def uptime_map(since: float) -> dict[int, float]:
    rows = db.query_all(
        "SELECT site_id, "
        "SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime "
        "FROM checks WHERE timestamp >= ? GROUP BY site_id",
        (since,),
    )
    return {row["site_id"]: round(row["uptime"], 1) for row in rows}


def list_sites(public_only: bool = False) -> list[dict]:
    where = "WHERE s.public = 1" if public_only else ""
    rows = db.query_all(
        "SELECT s.*, "
        "(SELECT started_at FROM incidents i WHERE i.site_id=s.id "
        " ORDER BY i.started_at DESC LIMIT 1) AS last_incident_time "
        f"FROM sites s {where} ORDER BY s.id"
    )
    uptime = uptime_map(time.time() - 86400)
    sites = [serialize_site(row) for row in rows]
    for site in sites:
        site["uptime_24h"] = uptime.get(site["id"])
    return sites


def get_site(site_id: int) -> dict | None:
    row = db.query_one(
        "SELECT s.*, "
        "(SELECT started_at FROM incidents i WHERE i.site_id=s.id "
        " ORDER BY i.started_at DESC LIMIT 1) AS last_incident_time "
        "FROM sites s WHERE s.id = ?",
        (site_id,),
    )
    return serialize_site(row) if row else None


def find_site_by_url(url: str) -> dict | None:
    row = db.query_one("SELECT * FROM sites WHERE url = ?", (url,))
    return serialize_site(row) if row else None


def create_site(
    url: str,
    name: str,
    check_interval_seconds: int | None,
    tags: list[str],
    public: bool,
) -> dict:
    now = time.time()
    with db.transaction() as conn:
        cursor = conn.execute(
            "INSERT INTO sites "
            "(url, name, check_interval_seconds, tags, public, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                url,
                name or url,
                check_interval_seconds,
                _encode_tags(tags),
                1 if public else 0,
                now,
                now,
            ),
        )
        site_id = cursor.lastrowid
    return get_site(site_id)


def update_site(
    site_id: int,
    url: str,
    name: str,
    check_interval_seconds: int | None,
    tags: list[str],
    public: bool,
) -> dict | None:
    with db.transaction() as conn:
        row = conn.execute("SELECT url FROM sites WHERE id=?", (site_id,)).fetchone()
        if not row:
            return None
        url_changed = row["url"] != url
        if url_changed:
            conn.execute(
                "UPDATE sites SET url=?, name=?, check_interval_seconds=?, "
                "tags=?, public=?, ssl_expires_at=NULL, ssl_checked_at=NULL, "
                "ssl_error=NULL, ssl_alerted=0, updated_at=? WHERE id=?",
                (
                    url,
                    name or url,
                    check_interval_seconds,
                    _encode_tags(tags),
                    1 if public else 0,
                    time.time(),
                    site_id,
                ),
            )
        else:
            conn.execute(
                "UPDATE sites SET url=?, name=?, check_interval_seconds=?, "
                "tags=?, public=?, updated_at=? WHERE id=?",
                (
                    url,
                    name or url,
                    check_interval_seconds,
                    _encode_tags(tags),
                    1 if public else 0,
                    time.time(),
                    site_id,
                ),
            )
    return get_site(site_id)


def set_paused(site_id: int, paused: bool) -> dict | None:
    with db.transaction() as conn:
        conn.execute(
            "UPDATE sites SET paused=?, updated_at=? WHERE id=?",
            (1 if paused else 0, time.time(), site_id),
        )
    return get_site(site_id)


def delete_site(site_id: int) -> bool:
    with db.transaction() as conn:
        cursor = conn.execute("DELETE FROM sites WHERE id=?", (site_id,))
    return cursor.rowcount > 0


def update_ssl(
    site_id: int,
    expires_at: float | None,
    error: str | None,
) -> bool:
    """Store the SSL state and return whether an expiry alert was already sent."""
    now = time.time()
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT ssl_expires_at, ssl_alerted FROM sites WHERE id=?", (site_id,)
        ).fetchone()
        if not row:
            return False
        alerted = row["ssl_alerted"]
        if expires_at is not None and expires_at > now:
            alerted = 0
        conn.execute(
            "UPDATE sites SET ssl_expires_at=?, ssl_checked_at=?, ssl_error=?, "
            "ssl_alerted=? WHERE id=?",
            (expires_at, now, error, alerted, site_id),
        )
        return bool(alerted)


def mark_ssl_alerted(site_id: int) -> None:
    with db.transaction() as conn:
        conn.execute("UPDATE sites SET ssl_alerted=1 WHERE id=?", (site_id,))


def _open_incident(conn, site_id: int):
    return conn.execute(
        "SELECT * FROM incidents WHERE site_id=? AND ended_at IS NULL "
        "ORDER BY started_at DESC LIMIT 1",
        (site_id,),
    ).fetchone()


def record_check(site_id: int, result: dict) -> dict | None:
    """Persist a check and return a transition event, if any."""
    now = time.time()
    with db.transaction() as conn:
        row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
        if not row:
            return None
        previous_status = row["last_status"]
        conn.execute(
            "INSERT INTO checks (site_id, timestamp, status, http_code, latency_ms, error) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                site_id,
                result["timestamp"],
                result["status"],
                result.get("http_code"),
                result.get("latency_ms"),
                result.get("error"),
            ),
        )
        conn.execute(
            "UPDATE sites SET last_status=?, last_check=?, last_http_code=?, "
            "last_latency_ms=?, last_error=? WHERE id=?",
            (
                result["status"],
                result["timestamp"],
                result.get("http_code"),
                result.get("latency_ms"),
                result.get("error"),
                site_id,
            ),
        )
        event = None
        if result["status"] == "down":
            incident = _open_incident(conn, site_id)
            if incident is None:
                cursor = conn.execute(
                    "INSERT INTO incidents (site_id, started_at, last_error) "
                    "VALUES (?, ?, ?)",
                    (site_id, result["timestamp"], result.get("error")),
                )
                event = {
                    "type": "down",
                    "incident_id": cursor.lastrowid,
                    "previous_status": previous_status,
                }
            else:
                conn.execute(
                    "UPDATE incidents SET last_error=? WHERE id=?",
                    (result.get("error"), incident["id"]),
                )
        elif result["status"] == "up":
            incident = _open_incident(conn, site_id)
            if incident is not None:
                conn.execute(
                    "UPDATE incidents SET ended_at=?, last_error=? WHERE id=?",
                    (
                        result["timestamp"],
                        result.get("error") or incident["last_error"],
                        incident["id"],
                    ),
                )
                event = {
                    "type": "up",
                    "incident_id": incident["id"],
                    "started_at": incident["started_at"],
                    "duration_seconds": max(
                        0, result["timestamp"] - incident["started_at"]
                    ),
                }
    return event


def get_open_incident(site_id: int) -> dict | None:
    row = db.query_one(
        "SELECT * FROM incidents WHERE site_id=? AND ended_at IS NULL "
        "ORDER BY started_at DESC LIMIT 1",
        (site_id,),
    )
    return dict(row) if row else None


def list_incidents(
    site_id: int | None = None,
    limit: int = 50,
    since: float | None = None,
    public_only: bool = False,
    open_only: bool = False,
) -> list[dict]:
    where = []
    params: list = []
    if site_id is not None:
        where.append("i.site_id = ?")
        params.append(site_id)
    if since is not None:
        where.append("i.started_at >= ?")
        params.append(since)
    if public_only:
        where.append("s.public = 1")
    if open_only:
        where.append("i.ended_at IS NULL")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params.append(limit)
    rows = db.query_all(
        "SELECT i.*, s.name AS site_name, s.url AS site_url, s.public AS site_public "
        "FROM incidents i JOIN sites s ON s.id = i.site_id "
        f"{clause} ORDER BY i.started_at DESC LIMIT ?",
        params,
    )
    incidents = []
    now = time.time()
    for row in rows:
        incident = dict(row)
        incident["site_public"] = bool(incident.get("site_public"))
        incident["ongoing"] = incident["ended_at"] is None
        end = incident["ended_at"] or now
        incident["duration_seconds"] = max(0, end - incident["started_at"])
        incidents.append(incident)
    return incidents


def acknowledge_incident(incident_id: int, note: str | None = None) -> dict | None:
    with db.transaction() as conn:
        conn.execute(
            "UPDATE incidents SET acknowledged_at=?, "
            "note=COALESCE(?, note) WHERE id=?",
            (time.time(), note, incident_id),
        )
    row = db.query_one("SELECT * FROM incidents WHERE id=?", (incident_id,))
    return dict(row) if row else None


def update_incident_note(incident_id: int, note: str) -> dict | None:
    with db.transaction() as conn:
        conn.execute("UPDATE incidents SET note=? WHERE id=?", (note, incident_id))
    row = db.query_one("SELECT * FROM incidents WHERE id=?", (incident_id,))
    return dict(row) if row else None


def list_checks(site_id: int, limit: int = 100) -> list[dict]:
    rows = db.query_all(
        "SELECT timestamp, status, http_code, latency_ms, error "
        "FROM checks WHERE site_id=? ORDER BY timestamp DESC LIMIT ?",
        (site_id, limit),
    )
    return [dict(row) for row in rows]


def site_stats(site_id: int, range_key: str = "24h") -> dict:
    duration, bucket_seconds = RANGES.get(range_key, RANGES["24h"])
    since = time.time() - duration
    totals = db.query_one(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up, "
        "AVG(latency_ms) AS avg_latency "
        "FROM checks WHERE site_id=? AND timestamp>=?",
        (site_id, since),
    )
    total = totals["total"] if totals else 0
    up = totals["up"] if totals and totals["up"] else 0
    points = db.query_all(
        "SELECT (CAST(strftime('%s', timestamp, 'unixepoch') AS INTEGER) / ?) * ? "
        "AS bucket, AVG(latency_ms) AS latency_ms, "
        "SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS uptime "
        "FROM checks WHERE site_id=? AND timestamp>=? "
        "GROUP BY bucket ORDER BY bucket",
        (bucket_seconds, bucket_seconds, site_id, since),
    )
    return {
        "range": range_key,
        "uptime_percent": round(up * 100.0 / total, 2) if total else None,
        "checks_count": total,
        "avg_latency_ms": round(totals["avg_latency"], 1)
        if totals and totals["avg_latency"] is not None
        else None,
        "points": [
            {
                "timestamp": row["bucket"],
                "latency_ms": round(row["latency_ms"], 1)
                if row["latency_ms"] is not None
                else None,
                "uptime_percent": round(row["uptime"], 1)
                if row["uptime"] is not None
                else None,
            }
            for row in points
        ],
    }


def list_public_status() -> dict:
    settings = get_settings()
    sites = list_sites(public_only=True)
    now = time.time()
    uptime_7d = uptime_map(now - 7 * 86400)
    for site in sites:
        site["uptime_7d"] = uptime_7d.get(site["id"])
        site["last_error"] = None
        site["ssl_error"] = None
    incidents = list_incidents(
        since=now - 7 * 86400, public_only=True, limit=20
    )
    for incident in incidents:
        incident["last_error"] = None
        incident["note"] = None
    return {
        "title": settings.get("status_page_title", "Статус сервисов"),
        "description": settings.get("status_page_description", ""),
        "project_name": settings.get("project_name", "VibeMonitor"),
        "sites": sites,
        "incidents": incidents,
    }


def count_users() -> int:
    return db.query_one("SELECT COUNT(*) AS n FROM users")["n"]


def list_users() -> list[dict]:
    rows = db.query_all(
        "SELECT id, username, role, created_at FROM users ORDER BY username"
    )
    return [dict(row) for row in rows]


def get_user_by_username(username: str):
    return db.query_one("SELECT * FROM users WHERE username=?", (username,))


def get_user(user_id: int):
    return db.query_one("SELECT * FROM users WHERE id=?", (user_id,))


def create_user(username: str, password_hash: str, role: str) -> dict:
    with db.transaction() as conn:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, role, created_at) "
            "VALUES (?, ?, ?, ?)",
            (username, password_hash, role, time.time()),
        )
        user_id = cursor.lastrowid
    return dict(get_user(user_id))


def update_user_role(user_id: int, role: str) -> None:
    with db.transaction() as conn:
        conn.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))


def update_user_password(user_id: int, password_hash: str) -> None:
    with db.transaction() as conn:
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?", (password_hash, user_id)
        )


def delete_user(user_id: int) -> bool:
    with db.transaction() as conn:
        cursor = conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    return cursor.rowcount > 0


def count_admins() -> int:
    return db.query_one(
        "SELECT COUNT(*) AS n FROM users WHERE role='admin'"
    )["n"]


def delete_user_sessions(user_id: int) -> None:
    with db.transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))


def create_session(token_hash: str, user_id: int, expires_at: float) -> None:
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) "
            "VALUES (?, ?, ?, ?)",
            (token_hash, user_id, expires_at, time.time()),
        )


def get_session(token_hash: str):
    return db.query_one(
        "SELECT se.*, u.username, u.role FROM sessions se "
        "JOIN users u ON u.id=se.user_id "
        "WHERE se.token_hash=? AND se.expires_at>?",
        (token_hash, time.time()),
    )


def delete_session(token_hash: str) -> None:
    with db.transaction() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))


def list_recipients(enabled_only: bool = False) -> list[dict]:
    where = "WHERE enabled=1" if enabled_only else ""
    rows = db.query_all(
        f"SELECT * FROM notification_recipients {where} ORDER BY id"
    )
    recipients = []
    for row in rows:
        recipient = dict(row)
        recipient["enabled"] = bool(recipient["enabled"])
        recipients.append(recipient)
    return recipients


def create_recipient(chat_id: str, label: str) -> dict:
    with db.transaction() as conn:
        cursor = conn.execute(
            "INSERT INTO notification_recipients (chat_id, label, created_at) "
            "VALUES (?, ?, ?)",
            (chat_id, label, time.time()),
        )
        recipient_id = cursor.lastrowid
    row = db.query_one(
        "SELECT * FROM notification_recipients WHERE id=?", (recipient_id,)
    )
    recipient = dict(row)
    recipient["enabled"] = bool(recipient["enabled"])
    return recipient


def update_recipient(
    recipient_id: int, label: str | None = None, enabled: bool | None = None
) -> dict | None:
    with db.transaction() as conn:
        if label is not None:
            conn.execute(
                "UPDATE notification_recipients SET label=? WHERE id=?",
                (label, recipient_id),
            )
        if enabled is not None:
            conn.execute(
                "UPDATE notification_recipients SET enabled=? WHERE id=?",
                (1 if enabled else 0, recipient_id),
            )
    row = db.query_one(
        "SELECT * FROM notification_recipients WHERE id=?", (recipient_id,)
    )
    if not row:
        return None
    recipient = dict(row)
    recipient["enabled"] = bool(recipient["enabled"])
    return recipient


def delete_recipient(recipient_id: int) -> bool:
    with db.transaction() as conn:
        cursor = conn.execute(
            "DELETE FROM notification_recipients WHERE id=?", (recipient_id,)
        )
    return cursor.rowcount > 0


def cleanup_old_data() -> None:
    settings = get_settings()
    check_days = int(settings.get("retention_days", 30))
    incident_days = int(settings.get("incident_retention_days", 180))
    now = time.time()
    with db.transaction() as conn:
        conn.execute(
            "DELETE FROM checks WHERE timestamp < ?", (now - check_days * 86400,)
        )
        conn.execute(
            "DELETE FROM incidents WHERE ended_at IS NOT NULL AND ended_at < ?",
            (now - incident_days * 86400,),
        )
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))


def health() -> bool:
    try:
        db.query_one("SELECT 1")
        return True
    except Exception:
        return False
