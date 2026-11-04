"""Structured logging. One JSON object per line; secrets never reach a log line.

Anything passed in `extra` whose key looks secret is replaced, and so is any `key=value` in the
message text whose key looks secret. Adapters log device names and addresses, never credentials.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from typing import Any

_SECRET_KEY = re.compile(r"(pass(word)?|psk|secret|token|local_?key|device_?key|api_?key|pin_?key|credential)", re.I)
_SECRET_PAIR = re.compile(
    r"((?:pass(?:word)?|psk|secret|token|local_?key|device_?key|api_?key)\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|\S+)", re.I
)
_STANDARD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime", "color_message", "taskName"}
REDACTED = "[redacted]"


def redact(value: Any, key: str | None = None) -> Any:
    if key is not None and _SECRET_KEY.search(key):
        return REDACTED
    if isinstance(value, dict):
        return {k: redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return _SECRET_PAIR.sub(lambda m: m.group(1) + REDACTED, value)
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        for key, value in vars(record).items():
            if key not in _STANDARD and not key.startswith("_"):
                entry[key] = redact(value, key)
        if record.exc_info:
            entry["error"] = redact(self.formatException(record.exc_info))
        return json.dumps(entry, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        extras = {k: redact(v, k) for k, v in vars(record).items() if k not in _STANDARD and not k.startswith("_")}
        line = f"{time.strftime('%H:%M:%S')} {record.levelname:<7} {record.name}: {redact(record.getMessage())}"
        if extras:
            line += " " + json.dumps(extras, default=str, ensure_ascii=False)
        if record.exc_info:
            line += "\n" + redact(self.formatException(record.exc_info))
        return line


def configure(level: str = "INFO", fmt: str = "json") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Library chatter that would otherwise drown the gateway's own lines.
    for noisy in ("zeroconf", "aiowebostv", "samsungtvws", "kasa", "tinytuya", "websockets", "httpx", "aiomqtt"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, logging.getLevelName(level)))
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
