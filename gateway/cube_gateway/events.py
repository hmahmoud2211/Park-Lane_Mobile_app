"""In-process publish/subscribe that feeds the WebSocket clients (local and through the relay).

Each subscriber gets a bounded queue. A client that stops reading loses its oldest events rather than
growing memory; it re-reads /devices after reconnecting anyway.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from .models import Event

log = logging.getLogger("cube.events")
QUEUE_SIZE = 256


class Subscription:
    def __init__(self, bus: EventBus, client_id: str | None):
        self.bus = bus
        self.client_id = client_id
        self.queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.closed = asyncio.Event()

    def push(self, event: Event) -> None:
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
        self.queue.put_nowait(event)

    async def next(self) -> Event | None:
        """The next event, or None once the subscription is closed (e.g. the client was revoked)."""
        getter = asyncio.ensure_future(self.queue.get())
        closer = asyncio.ensure_future(self.closed.wait())
        try:
            done, _ = await asyncio.wait({getter, closer}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            getter.cancel()
            closer.cancel()
        if getter in done and not getter.cancelled():
            return getter.result()
        return None

    def close(self) -> None:
        self.closed.set()
        self.bus._subs.discard(self)


class EventBus:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()

    def subscribe(self, client_id: str | None = None) -> Subscription:
        sub = Subscription(self, client_id)
        self._subs.add(sub)
        return sub

    def publish(self, type_: str, **data: Any) -> None:
        event = Event(type=type_, data=data)
        for sub in list(self._subs):
            sub.push(event)

    def close_client(self, client_id: str) -> None:
        for sub in list(self._subs):
            if sub.client_id == client_id:
                sub.push(Event(type="client.revoked", data={"id": client_id}))
                sub.close()

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)
