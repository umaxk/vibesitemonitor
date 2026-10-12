import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

import httpx

from app import config as app_config

logger = logging.getLogger("monitor")

LOG_PATH = Path(__file__).parent.parent / "monitor.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(),
    ],
)


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

    async def _check_site(self, url: str) -> CheckResult:
        start = time.time()
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, follow_redirects=True
            ) as client:
                resp = await client.get(url)
                latency = (time.time() - start) * 1000
                status = "up" if resp.status_code < 400 else "down"
                return CheckResult(
                    url=url,
                    timestamp=start,
                    status=status,
                    http_code=resp.status_code,
                    latency_ms=round(latency, 1),
                    error=None if status == "up" else f"HTTP {resp.status_code}",
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
        except httpx.RequestError as e:
            return CheckResult(
                url=url,
                timestamp=start,
                status="down",
                http_code=None,
                latency_ms=None,
                error=str(e),
            )

    async def _run_checks(self):
        cfg = app_config.load_config()
        self._interval = cfg.get("check_interval_seconds", 60)
        self._timeout = cfg.get("timeout_seconds", 10)
        self._sync_sites(cfg.get("sites", []))

        now = time.time()
        tasks = []
        for url, state in self._states.items():
            if state.next_check is None or now >= state.next_check:
                tasks.append(self._check_site(url))
        if not tasks:
            return
        results = await asyncio.gather(*tasks)
        for result in results:
            state = self._states[result.url]
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
                state.last_incident_time = result.timestamp
                logger.warning(
                    "Site DOWN: %s | error=%s | http_code=%s",
                    result.url,
                    result.error,
                    result.http_code,
                )

    async def _loop(self):
        while not self._stop_event.is_set():
            try:
                await self._run_checks()
            except Exception as e:
                logger.error("Monitor loop error: %s", e)
            min_interval = self._interval
            for state in self._states.values():
                if state.check_interval:
                    min_interval = min(min_interval, state.check_interval)
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=min_interval
                )
            except asyncio.TimeoutError:
                pass

    def start(self):
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._task = asyncio.create_task(self._loop())

    def stop(self):
        self._stop_event.set()

    def update_settings(self, interval: int, timeout: int):
        self._interval = interval
        self._timeout = timeout

    def get_states(self) -> List[SiteState]:
        return list(self._states.values())

    def get_state(self, url: str) -> SiteState | None:
        return self._states.get(url)


monitor = Monitor()
