import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Dict, List

import httpx

from app import config as app_config

logger = logging.getLogger("monitor")

BASE_DIR = Path(__file__).resolve().parent.parent
LOG_PATH = Path(
    os.environ.get("MONITOR_LOG_PATH") or (BASE_DIR / "monitor.log")
)

LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

_root_logger = logging.getLogger()
if not any(
    isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
    for h in _root_logger.handlers
):
    _root_logger.addHandler(logging.StreamHandler())

if not any(getattr(h, "_vibemonitor_file", False) for h in _root_logger.handlers):
    _file_handler = RotatingFileHandler(
        LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    _file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    )
    _file_handler._vibemonitor_file = True
    _root_logger.addHandler(_file_handler)

_root_logger.setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

REQUEST_HEADERS = {"User-Agent": "VibeMonitor/1.0"}


@dataclass
class CheckResult:
    url: str
    timestamp: float
    status: str
    http_code: int | None
    latency_ms: float | None
    error: str | None


@dataclass
class SiteState:
    url: str
    name: str
    status: str = "unknown"
    last_check: float | None = None
    http_code: int | None = None
    latency_ms: float | None = None
    error: str | None = None
    history: List[CheckResult] = field(default_factory=list)
    check_interval: int | None = None
    next_check: float | None = None
    last_incident_time: float | None = None


class Monitor:
    def __init__(self):
        self._states: Dict[str, SiteState] = {}
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._interval = 60
        self._timeout = 10

    def _sync_sites(self, sites: list):
        urls = {s["url"] for s in sites}
        for url in list(self._states.keys()):
            if url not in urls:
                del self._states[url]
        for site in sites:
            url = site["url"]
            if url not in self._states:
                self._states[url] = SiteState(
                    url=url,
                    name=site.get("name", url),
                    check_interval=site.get("check_interval_seconds"),
                )
            else:
                self._states[url].name = site.get("name", url)
                self._states[url].check_interval = site.get("check_interval_seconds")

    async def _status_code(self, client: httpx.AsyncClient, url: str) -> int:
        resp = await client.head(url)
        if resp.status_code in (403, 405, 501):
            async with client.stream("GET", url) as get_resp:
                return get_resp.status_code
        return resp.status_code

    async def _check_site(self, url: str) -> CheckResult:
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
            return CheckResult(
                url=url,
                timestamp=start,
                status=status,
                http_code=status_code,
                latency_ms=round(latency, 1),
                error=None if status == "up" else f"HTTP {status_code}",
            )
        except httpx.TimeoutException:
            return CheckResult(
                url=url,
                timestamp=start,
                status="down",
                http_code=None,
                latency_ms=None,
                error="Timeout",
            )
        except Exception as e:  # noqa: BLE001 - a single bad site must not stop the loop
            return CheckResult(
                url=url,
                timestamp=start,
                status="down",
                http_code=None,
                latency_ms=None,
                error=f"{type(e).__name__}: {e}",
            )

    def _apply_result(self, result: CheckResult) -> None:
        state = self._states.get(result.url)
        if state is None:
            return
        previous_status = state.status
        previous_check = state.last_check

        state.status = result.status
        state.last_check = result.timestamp
        state.http_code = result.http_code
        state.latency_ms = result.latency_ms
        state.error = result.error
        state.history.append(result)
        if len(state.history) > 100:
            state.history = state.history[-100:]

        interval = state.check_interval or self._interval
        state.next_check = result.timestamp + interval

        if result.status == "down":
            if previous_status != "down" or state.last_incident_time is None:
                state.last_incident_time = result.timestamp
                logger.warning(
                    "Site DOWN: %s | error=%s | http_code=%s",
                    result.url,
                    result.error,
                    result.http_code,
                )
        elif previous_status == "down":
            state.last_incident_time = previous_check or result.timestamp
            logger.info(
                "Site UP: %s | http_code=%s | latency=%sms",
                result.url,
                result.http_code,
                result.latency_ms,
            )

    async def _run_checks(self):
        cfg = app_config.load_config()
        self._interval = cfg.get("check_interval_seconds", 60)
        self._timeout = cfg.get("timeout_seconds", 10)
        self._sync_sites(cfg.get("sites", []))

        now = time.time()
        tasks = {
            url: asyncio.create_task(self._check_site(url))
            for url, state in self._states.items()
            if state.next_check is None or now >= state.next_check
        }
        if not tasks:
            return

        urls = list(tasks)
        results = await asyncio.gather(
            *(tasks[url] for url in urls), return_exceptions=True
        )
        for url, result in zip(urls, results):
            if isinstance(result, BaseException):
                result = CheckResult(
                    url=url,
                    timestamp=time.time(),
                    status="down",
                    http_code=None,
                    latency_ms=None,
                    error=f"{type(result).__name__}: {result}",
                )
            self._apply_result(result)

    def _next_wait(self) -> float:
        deadlines = [
            state.next_check
            for state in self._states.values()
            if state.next_check is not None
        ]
        if not deadlines:
            return max(1.0, self._interval)
        return max(1.0, min(deadlines) - time.time())

    async def _loop(self):
        while not self._stop_event.is_set():
            try:
                await self._run_checks()
            except Exception as e:  # noqa: BLE001 - keep the monitor alive
                logger.error("Monitor loop error: %s", e)
            try:
                await asyncio.wait_for(
                    self._wake_event.wait(), timeout=self._next_wait()
                )
            except asyncio.TimeoutError:
                pass
            self._wake_event.clear()

    def start(self):
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._wake_event.clear()
            self._task = asyncio.create_task(self._loop())

    def stop(self):
        self._stop_event.set()
        self._wake_event.set()

    def wake(self):
        self._wake_event.set()

    def update_site(
        self, old_url: str, new_url: str, name: str, interval: int | None
    ):
        state = self._states.pop(old_url, None)
        if state is not None:
            state.url = new_url
            state.name = name
            state.check_interval = interval
            state.next_check = time.time()
            for check in state.history:
                check.url = new_url
            self._states[new_url] = state
        self._wake_event.set()

    def update_settings(self, interval: int, timeout: int):
        self._interval = interval
        self._timeout = timeout
        now = time.time()
        for state in self._states.values():
            state.next_check = now
        self._wake_event.set()

    def get_states(self) -> List[SiteState]:
        return list(self._states.values())

    def get_state(self, url: str) -> SiteState | None:
        return self._states.get(url)


monitor = Monitor()
