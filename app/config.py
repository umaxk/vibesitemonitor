import json
import os
import threading
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config.json"

_lock = threading.Lock()

DEFAULT_CONFIG = {
    "check_interval_seconds": 60,
    "timeout_seconds": 10,
    "sites": [],
}


def load_config() -> dict:
    with _lock:
        if not CONFIG_PATH.exists():
            save_config(DEFAULT_CONFIG)
            return DEFAULT_CONFIG.copy()
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            merged = DEFAULT_CONFIG.copy()
            merged.update(data)
            return merged
        except (json.JSONDecodeError, OSError):
            return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> None:
    with _lock:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
