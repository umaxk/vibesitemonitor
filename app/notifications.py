import html
import logging
import os
import time
from datetime import datetime

import httpx

from app import repository

logger = logging.getLogger("notifications")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()

MESSAGES = {
    "ru": {
        "units": {"sec": "сек", "min": "мин", "hr": "ч", "day": "дн"},
        "ssl_expired_at": "SSL-сертификат истёк {time}",
        "down_title": "<b>{name}</b> недоступен",
        "up_title": "<b>{name}</b> снова доступен",
        "ssl_title": "<b>{name}</b>: срок действия SSL-сертификата истёк",
        "error": "Ошибка: {error}",
        "time": "Время: {time}",
        "downtime": "Простой: {duration}",
        "expired_at": "Истёк: {time}",
        "test": "<b>VibeMonitor</b>\nТестовое уведомление. Если вы его видите, бот настроен правильно.",
    },
    "en": {
        "units": {"sec": "sec", "min": "min", "hr": "h", "day": "d"},
        "ssl_expired_at": "SSL certificate expired {time}",
        "down_title": "<b>{name}</b> is down",
        "up_title": "<b>{name}</b> is back up",
        "ssl_title": "<b>{name}</b>: SSL certificate has expired",
        "error": "Error: {error}",
        "time": "Time: {time}",
        "downtime": "Downtime: {duration}",
        "expired_at": "Expired: {time}",
        "test": "<b>VibeMonitor</b>\nTest notification. If you see this, the bot is set up correctly.",
    },
}


def _lang() -> str:
    settings = repository.get_settings()
    return "en" if settings.get("ui_language") == "en" else "ru"


def _msg(code: str) -> str:
    return MESSAGES[_lang()][code]


def is_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN)


def _format_time(timestamp: float | None) -> str:
    if not timestamp:
        return "—"
    return datetime.fromtimestamp(timestamp).strftime("%d.%m.%Y %H:%M")


def _format_duration(seconds: float) -> str:
    seconds = int(seconds)
    units = MESSAGES[_lang()]["units"]
    if seconds < 60:
        return f"{seconds} {units['sec']}"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} {units['min']}"
    if minutes < 60 * 24:
        return f"{minutes // 60} {units['hr']} {minutes % 60} {units['min']}"
    return f"{minutes // (60 * 24)} {units['day']} {(minutes % (60 * 24)) // 60} {units['hr']}"


def _certificate_line(site: dict) -> str | None:
    expires = site.get("ssl_expires_at")
    if expires and expires <= time.time():
        return _msg("ssl_expired_at").format(time=_format_time(expires))
    return None


async def _send_text(text: str) -> int:
    if not TELEGRAM_BOT_TOKEN:
        return 0
    recipients = repository.list_recipients(enabled_only=True)
    if not recipients:
        return 0
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    sent = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for recipient in recipients:
            try:
                response = await client.post(
                    url,
                    json={
                        "chat_id": recipient["chat_id"],
                        "text": text,
                        "parse_mode": "HTML",
                        "disable_web_page_preview": True,
                    },
                )
                if response.status_code >= 400:
                    logger.warning(
                        "Telegram send failed for chat %s: HTTP %s",
                        recipient["chat_id"],
                        response.status_code,
                    )
                else:
                    sent += 1
            except httpx.HTTPError as exc:
                logger.warning(
                    "Telegram send failed for chat %s: %s",
                    recipient["chat_id"],
                    exc,
                )
    return sent


async def _safe_send(text: str) -> int:
    try:
        return await _send_text(text)
    except Exception as exc:  # noqa: BLE001 - notifications must not break checks
        logger.warning("Notification error: %s", exc)
        return 0


async def notify_site_down(site: dict, event: dict | None = None) -> None:
    lines = [
        _msg("down_title").format(name=html.escape(site["name"])),
        f"URL: {html.escape(site['url'])}",
        _msg("error").format(error=html.escape(str(site.get("last_error") or "unknown"))),
        _msg("time").format(time=_format_time(site.get("last_check"))),
    ]
    certificate = _certificate_line(site)
    if certificate:
        lines.append(certificate)
    await _safe_send("\n".join(lines))


async def notify_site_up(site: dict, event: dict | None = None) -> None:
    lines = [
        _msg("up_title").format(name=html.escape(site["name"])),
        f"URL: {html.escape(site['url'])}",
    ]
    if event and event.get("duration_seconds") is not None:
        lines.append(
            _msg("downtime").format(duration=_format_duration(event["duration_seconds"]))
        )
    lines.append(_msg("time").format(time=_format_time(site.get("last_check"))))
    await _safe_send("\n".join(lines))


async def notify_ssl_expired(site: dict) -> None:
    lines = [
        _msg("ssl_title").format(name=html.escape(site["name"])),
        f"URL: {html.escape(site['url'])}",
        _msg("expired_at").format(time=_format_time(site.get("ssl_expires_at"))),
    ]
    await _safe_send("\n".join(lines))


async def send_test() -> dict:
    if not is_configured():
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN is not set"}
    recipients = repository.list_recipients(enabled_only=True)
    if not recipients:
        return {"ok": False, "error": "No enabled recipients"}
    text = _msg("test")
    sent = await _safe_send(text)
    if not sent:
        return {"ok": False, "error": "Telegram send failed for all recipients"}
    return {"ok": True, "recipients": len(recipients), "sent": sent}
