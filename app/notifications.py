import html
import logging
import os
import time
from datetime import datetime

import httpx

from app import repository

logger = logging.getLogger("notifications")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


def is_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN)


def _format_time(timestamp: float | None) -> str:
    if not timestamp:
        return "—"
    return datetime.fromtimestamp(timestamp).strftime("%d.%m.%Y %H:%M")


def _format_duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds} сек"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} мин"
    hours = minutes // 60
    return f"{hours} ч {minutes % 60} мин"


def _certificate_line(site: dict) -> str | None:
    expires = site.get("ssl_expires_at")
    if expires and expires <= time.time():
        return f"SSL-сертификат истёк {_format_time(expires)}"
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
        f"<b>{html.escape(site['name'])}</b> недоступен",
        f"URL: {html.escape(site['url'])}",
        f"Ошибка: {html.escape(str(site.get('last_error') or 'unknown'))}",
        f"Время: {_format_time(site.get('last_check'))}",
    ]
    certificate = _certificate_line(site)
    if certificate:
        lines.append(certificate)
    await _safe_send("\n".join(lines))


async def notify_site_up(site: dict, event: dict | None = None) -> None:
    lines = [
        f"<b>{html.escape(site['name'])}</b> снова доступен",
        f"URL: {html.escape(site['url'])}",
    ]
    if event and event.get("duration_seconds") is not None:
        lines.append(f"Простой: {_format_duration(event['duration_seconds'])}")
    lines.append(f"Время: {_format_time(site.get('last_check'))}")
    await _safe_send("\n".join(lines))


async def notify_ssl_expired(site: dict) -> None:
    lines = [
        f"<b>{html.escape(site['name'])}</b>: срок действия SSL-сертификата истёк",
        f"URL: {html.escape(site['url'])}",
        f"Истёк: {_format_time(site.get('ssl_expires_at'))}",
    ]
    await _safe_send("\n".join(lines))


async def send_test() -> dict:
    if not is_configured():
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN is not set"}
    recipients = repository.list_recipients(enabled_only=True)
    if not recipients:
        return {"ok": False, "error": "No enabled recipients"}
    text = (
        "<b>VibeMonitor</b>\n"
        "Тестовое уведомление. Если вы его видите, бот настроен правильно."
    )
    sent = await _safe_send(text)
    if not sent:
        return {"ok": False, "error": "Telegram send failed for all recipients"}
    return {"ok": True, "recipients": len(recipients), "sent": sent}
