"""Fire-and-forget background tasks that are kept alive and whose failures are logged.

asyncio holds only a weak reference to a task, so a task nobody keeps can be garbage-collected before it
finishes, and an exception inside it surfaces only if and when it is collected. `spawn()` keeps each task
until it is done and logs anything it raised.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

log = logging.getLogger("cube.tasks")
_running: set[asyncio.Task[Any]] = set()


def spawn(coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task[Any]:
    """Starts `coro` on the running loop, keeps it until it finishes and logs it if it fails."""
    task = asyncio.get_running_loop().create_task(coro, name=name)
    _running.add(task)
    task.add_done_callback(_finished)
    return task


def _finished(task: asyncio.Task[Any]) -> None:
    _running.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        log.error("background task failed", exc_info=error, extra={"task": task.get_name()})
