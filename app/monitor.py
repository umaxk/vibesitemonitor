import asyncio
import logging
import time

import httpx

from app import logging_config, notifications, repository, ssl_check

logging_config.setup()
logger = logging.getLogger("monitor")

REQUEST_HEADERS = {"User-Agent": "VibeMonitor/1.0"}


class Monitor:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._next_check: dict[int, float] = {}
        self._locks: dict[int, asyncio.Lock] = {}
        self._inflight: set[int] = set()
        self._ssl_inflight: set[int] = set()
        self._default_interval = 60
        self._timeout = 10
        self._last_loop: float | None = None
        self._last_cleanup = 0.0

    async def _status_code(self, client: httpx.AsyncClient, url: str) -> int:
        resp = await client.head(url)
        if resp.status_code in (403, 405, 501):
            async with client.stream("GET", url) as get_resp:
                return get_resp.status_code
        return resp.status_code

    async def _check_site(self, url: str) -> dict:
        start = time.time()
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout,
                follow_redirects=True,
                headers=REQUEST_HEADERS,
            ) as client:
                status_code = await self._status_code(client, url)
            latency = (time.time() - start) * 1000
            status = "up" if status_code < 400 else "down"
            return {
                "timestamp": start,
                "status": status,
                "http_code": status_code,
                "latency_ms": round(latency, 1),
                "error": None if status == "up" else f"HTTP {status_code}",
            }
        except httpx.TimeoutException:
            return {
                "timestamp": start,
                "status": "down",
                "http_code": None,
                "latency_ms": None,
                "error": "Timeout",
            }
        except Exception as exc:  # noqa: BLE001 - one bad site must not stop the loop
            return {
                "timestamp": start,
                "status": "down",
                "http_code": None,
                "latency_ms": None,
                "error": f"{type(exc).__name__}: {exc}",
            }

    def _lock_for(self, site_id: int) -> asyncio.Lock:
        lock = self._locks.get(site_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[site_id] = lock
        return lock

    async def _run_site_check(self, site: dict) -> dict | None:
        site_id = site["id"]
        async with self._lock_for(site_id):
            try:
                result = await self._check_site(site["url"])
                event = repository.record_check(site_id, result)
                updated = repository.get_site(site_id)
                if not updated:
                    return None
                if event:
                    if event["type"] == "down":
                        logger.warning(
                            "Site DOWN: %s | error=%s",
                            updated["url"],
                            updated.get("last_error"),
                            extra={"site_id": site_id, "incident_id": event["incident_id"]},
                        )
                        await notifications.notify_site_down(updated, event)
                    elif event["type"] == "up":
                        logger.info(
                            "Site UP: %s | duration=%ss",
                            updated["url"],
                            event.get("duration_seconds"),
                            extra={"site_id": site_id, "incident_id": event["incident_id"]},
                        )
                        await notifications.notify_site_up(updated, event)
                interval = updated.get("check_interval_seconds") or self._default_interval
                self._next_check[site_id] = time.time() + max(5, interval)
                return updated
            finally:
                self._inflight.discard(site_id)

    async def _run_ssl_check(self, site: dict) -> None:
        site_id = site["id"]
        try:
            expires_at, error = await ssl_check.get_certificate_expiry(
                site["url"], timeout=self._timeout
            )
            alerted = repository.update_ssl(site_id, expires_at, error)
            updated = repository.get_site(site_id)
            if not updated or not expires_at:
                return
            if expires_at > time.time():
                return
            if alerted:
                return
            if updated.get("last_status") != "down":
                logger.warning(
                    "SSL certificate expired: %s",
                    updated["url"],
                    extra={"site_id": site_id},
                )
                await notifications.notify_ssl_expired(updated)
                repository.mark_ssl_alerted(site_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("SSL check error for site %s: %s", site_id, exc)
        finally:
            self._ssl_inflight.discard(site_id)

    async def _tick(self) -> None:
        settings = repository.get_settings()
        self._default_interval = int(settings.get("check_interval_seconds", 60))
        self._timeout = int(settings.get("timeout_seconds", 10))
        ssl_interval = int(settings.get("ssl_check_interval_seconds", 21600))
        sites = repository.list_sites()

        alive_ids = {site["id"] for site in sites}
        for site_id in list(self._next_check):
            if site_id not in alive_ids:
                self._next_check.pop(site_id, None)
                self._locks.pop(site_id, None)

        now = time.time()
        tasks = []
        for site in sites:
            site_id = site["id"]
            if site["paused"]:
                self._next_check.pop(site_id, None)
                continue
            if site_id not in self._next_check:
                self._next_check[site_id] = now
            if now >= self._next_check[site_id] and site_id not in self._inflight:
                self._inflight.add(site_id)
                tasks.append(self._run_site_check(site))

            checked_at = site.get("ssl_checked_at")
            if (
                site["url"].lower().startswith("https://")
                and site_id not in self._ssl_inflight
                and (not checked_at or now - checked_at >= ssl_interval)
            ):
                self._ssl_inflight.add(site_id)
                tasks.append(self._run_ssl_check(site))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        if now - self._last_cleanup > 86400:
            self._last_cleanup = now
            try:
                repository.cleanup_old_data()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Cleanup error: %s", exc)

    def _next_wait(self) -> float:
        if not self._next_check:
            return max(1.0, float(self._default_interval))
        return max(1.0, min(self._next_check.values()) - time.time())

    async def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self._tick()
            except Exception as exc:  # noqa: BLE001 - keep the monitor alive
                logger.error("Monitor loop error: %s", exc)
            self._last_loop = time.time()
            try:
                await asyncio.wait_for(
                    self._wake_event.wait(), timeout=self._next_wait()
                )
            except asyncio.TimeoutError:
                pass
            self._wake_event.clear()

    async def check_now(self, site_id: int) -> dict | None:
        site = repository.get_site(site_id)
        if not site:
            return None
        self._inflight.add(site_id)
        self._next_check[site_id] = time.time()
        updated = await self._run_site_check(site)
        self._wake_event.set()
        return updated

    def site_changed(self, site_id: int) -> None:
        self._next_check[site_id] = time.time()
        self._wake_event.set()

    def site_removed(self, site_id: int) -> None:
        self._next_check.pop(site_id, None)
        self._locks.pop(site_id, None)
        self._wake_event.set()

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._wake_event.clear()
            self._task = asyncio.create_task(self._loop())

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()

    def wake(self) -> None:
        self._wake_event.set()

    def last_loop(self) -> float | None:
        return self._last_loop


monitor = Monitor()
