import json
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
LOG_PATH = Path(
    os.environ.get("MONITOR_LOG_PATH") or (BASE_DIR / "monitor.log")
)

LOG_FORMAT = os.environ.get("LOG_FORMAT", "text").lower()
EXTRA_FIELDS = (
    "request_id",
    "method",
    "path",
    "status",
    "duration_ms",
    "user",
    "site_id",
    "incident_id",
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in EXTRA_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup() -> None:
    root = logging.getLogger()
    if getattr(root, "_vibemonitor_configured", False):
        return

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    formatter = (
        JsonFormatter()
        if LOG_FORMAT == "json"
        else logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    )

    file_handler = RotatingFileHandler(
        LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    root._vibemonitor_configured = True
