import copy
import json
import os
import tempfile
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(
    os.environ.get("MONITOR_CONFIG_PATH") or (BASE_DIR / "config.json")
)

_lock = threading.RLock()

DEFAULT_CONFIG = {
    "project_name": "VibeMonitor",
    "check_interval_seconds": 60,
    "timeout_seconds": 10,
    "incident_hide_hours": 12,
    "sites": [],
    "session_tokens": [],
}


def _write_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=str(CONFIG_PATH.parent), prefix=".config-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, CONFIG_PATH)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def load_config() -> dict:
    with _lock:
        if not CONFIG_PATH.exists():
            config = copy.deepcopy(DEFAULT_CONFIG)
            _write_config(config)
            return config
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return copy.deepcopy(DEFAULT_CONFIG)
        if not isinstance(data, dict):
            return copy.deepcopy(DEFAULT_CONFIG)
        merged = copy.deepcopy(DEFAULT_CONFIG)
        merged.update(data)
        return merged


def save_config(config: dict) -> None:
    with _lock:
        _write_config(config)
