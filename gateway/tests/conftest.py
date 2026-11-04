from __future__ import annotations

import ipaddress
import time
from collections.abc import Iterator
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from cube_gateway.adapters.base import AdapterContext
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.api import create_app
from cube_gateway.config import Settings, load_settings
from cube_gateway.gateway import Gateway
from tests.fakes import FakeAdapter, FakeMdns


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("CUBE_LOG_FORMAT", "text")
    base = load_settings()
    # Scans in tests stay on a fixed private /24; nothing is probed.
    return replace(base, scan_subnets=[ipaddress.ip_network("192.168.50.0/24")], subnet_scan=False, mdns_advertise=False, poll_interval=5)


class Harness:
    """A running gateway behind TestClient, with fake adapters and mDNS."""

    def __init__(self, settings: Settings, adapters: list[type[FakeAdapter] | FakeAdapter] | None = None, real: bool = False):
        self.settings = settings
        self.mdns = FakeMdns()
        self.ctx = AdapterContext(settings)
        self.ctx.mdns = self.mdns
        self.registry = AdapterRegistry(self.ctx) if real else AdapterRegistry(self.ctx, modules=[])
        self.fake = FakeAdapter(self.ctx)
        if not real:
            self.registry.add(self.fake)
        for extra in adapters or []:
            self.registry.add(extra if isinstance(extra, FakeAdapter) else extra(self.ctx))
        self.gateway = Gateway(settings, registry=self.registry, mdns=self.mdns)  # type: ignore[arg-type]
        self.app = create_app(settings, self.gateway)
        self.client = TestClient(self.app)
        self.token: str | None = None

    def __enter__(self) -> Harness:
        self.client.__enter__()
        return self

    def __exit__(self, *exc) -> None:
        self.client.__exit__(*exc)

    def claim(self, name: str = "Owner phone") -> dict:
        code = self.gateway.security.setup_code
        response = self.client.post("/api/v1/auth/claim", json={"setup_code": code, "client_name": name})
        assert response.status_code == 201, response.text
        data = response.json()["data"]
        self.token = data["token"]
        return data

    def headers(self, token: str | None = None) -> dict[str, str]:
        return {"Authorization": f"Bearer {token or self.token}"}

    def get(self, path: str, **kw):
        return self.client.get(f"/api/v1{path}", headers=kw.pop("headers", self.headers()), **kw)

    def post(self, path: str, json=None, **kw):
        return self.client.post(f"/api/v1{path}", json=json, headers=kw.pop("headers", self.headers()), **kw)

    def patch(self, path: str, json=None, **kw):
        return self.client.patch(f"/api/v1{path}", json=json, headers=kw.pop("headers", self.headers()), **kw)

    def delete(self, path: str, **kw):
        return self.client.delete(f"/api/v1{path}", headers=kw.pop("headers", self.headers()), **kw)

    def wait(self, predicate, timeout: float = 5.0, interval: float = 0.05):
        deadline = time.time() + timeout
        while time.time() < deadline:
            result = predicate()
            if result:
                return result
            time.sleep(interval)
        raise AssertionError("condition not met in time")

    def scan(self, **body) -> dict:
        job = self.post("/discovery/jobs", json={"timeout": 3, **body}).json()["data"]
        return self.wait(lambda: (j := self.get(f"/discovery/jobs/{job['id']}").json()["data"])["status"] != "running" and j)

    def pair(self, candidate_id: str, **body) -> dict:
        pairing = self.post("/pairings", json={"candidate_id": candidate_id, **body}).json()["data"]
        return self.wait(lambda: (p := self.get(f"/pairings/{pairing['id']}").json()["data"])["status"] not in {"running", "awaiting_approval"} and p)


@pytest.fixture
def harness(settings) -> Iterator[Harness]:
    with Harness(settings) as h:
        yield h
