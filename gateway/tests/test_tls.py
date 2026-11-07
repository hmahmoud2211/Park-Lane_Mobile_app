"""Gateway HTTPS: SNI parsing, the ACME client against a strict fake CA, the relay's issuer, and the end-to-end
encrypted path (client -> relay pass-through -> tunnel -> gateway HTTPS listener) over real sockets on localhost.
"""

from __future__ import annotations

import asyncio
import base64
import datetime as dt
import json
import ssl
from dataclasses import replace
from typing import Any

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from cube_gateway.adapters.base import AdapterContext
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.api import create_app
from cube_gateway.db import Database
from cube_gateway.gateway import Gateway
from cube_gateway.relay import sni
from cube_gateway.relay.acme import AcmeClient, AcmeError, dns01_value, load_or_create_key
from cube_gateway.relay.client import enroll
from cube_gateway.relay.server import create_relay_app
from cube_gateway.relay.tls import TLS_SCHEMA, TlsIssuer, TlsRefused
from tests.fakes import FakeMdns
from tests.test_relay_and_misc import _free_port, _serve

GW = "0810268a-65a9-4059-a543-0e1daaa8ab51"


def _b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


# ---- a test CA and a strict fake ACME server ----------------------------------------------------------


class TestCA:
    def __init__(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CUBE Test CA")])
        now = dt.datetime.now(dt.UTC)
        self.cert = (
            x509.CertificateBuilder().subject_name(self.name).issuer_name(self.name).public_key(self.key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(self.key.public_key()), critical=False)
            .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
            .sign(self.key, hashes.SHA256())
        )

    def pem(self) -> str:
        return self.cert.public_bytes(serialization.Encoding.PEM).decode()

    def issue(self, public_key: Any, names: list[str], days: int = 90) -> str:
        now = dt.datetime.now(dt.UTC)
        leaf = (
            x509.CertificateBuilder().subject_name(x509.Name([])).issuer_name(self.name).public_key(public_key)
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(n) for n in names]), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            # Real CA certificates carry these, and Python's strict verification (3.13+) insists on them.
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(self.key.public_key()), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(public_key), critical=False)
            .sign(self.key, hashes.SHA256())
        )
        return leaf.public_bytes(serialization.Encoding.PEM).decode() + self.pem()


class FakeDns:
    def __init__(self) -> None:
        self.txt: dict[str, str] = {}
        self.a: dict[str, str] = {}
        self.deleted: list[str] = []

    async def set_txt(self, name: str, value: str) -> str:
        self.txt[name] = value
        return name

    async def delete(self, record: str) -> None:
        self.deleted.append(record)
        self.txt.pop(record, None)

    async def wait_visible(self) -> None:
        return None

    async def upsert_a(self, name: str, address: str) -> None:
        self.a[name] = address


class FakeAcme:
    """RFC 8555 as Let's Encrypt plays it: nonces are single-use, every JWS signature is checked (ES256, r||s), the
    DNS-01 TXT value must match the account key's thumbprint, and the CSR must name exactly the ordered names."""

    BASE = "https://acme.test"

    def __init__(self, ca: TestCA, dns: FakeDns) -> None:
        self.ca, self.dns = ca, dns
        self.nonces: set[str] = set()
        self.counter = 0
        self.accounts: dict[str, ec.EllipticCurvePublicKey] = {}
        self.orders: dict[str, dict] = {}
        self.authzs: dict[str, dict] = {}
        self.certs: dict[str, str] = {}
        self.bad_nonce_once = False
        self.issued = 0

    def _next(self) -> str:
        self.counter += 1
        return str(self.counter)

    def _nonce(self) -> str:
        nonce = f"n{self._next()}"
        self.nonces.add(nonce)
        return nonce

    def _reply(self, status: int, body: Any = None, *, location: str | None = None, text: str | None = None) -> httpx.Response:
        headers = {"Replay-Nonce": self._nonce()}
        if location:
            headers["Location"] = location
        if text is not None:
            return httpx.Response(status, text=text, headers={**headers, "Content-Type": "application/pem-certificate-chain"})
        return httpx.Response(status, json=body, headers=headers)

    def _problem(self, kind: str, detail: str, status: int = 400) -> httpx.Response:
        return self._reply(status, {"type": f"urn:ietf:params:acme:error:{kind}", "detail": detail})

    def _verify(self, request: httpx.Request) -> tuple[dict, Any, str | None]:
        body = json.loads(request.content)
        protected = json.loads(_b64d(body["protected"]))
        assert protected["alg"] == "ES256" and protected["url"] == str(request.url)
        if protected["nonce"] not in self.nonces:
            raise LookupError("badNonce")
        self.nonces.discard(protected["nonce"])
        if "jwk" in protected:
            jwk = protected["jwk"]
            key = ec.EllipticCurvePublicNumbers(int.from_bytes(_b64d(jwk["x"]), "big"), int.from_bytes(_b64d(jwk["y"]), "big"), ec.SECP256R1()).public_key()
            kid = None
        else:
            kid = protected["kid"]
            key = self.accounts[kid]
        signature = _b64d(body["signature"])
        assert len(signature) == 64, "ES256 signatures are r||s, not DER"
        der = encode_dss_signature(int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big"))
        key.verify(der, f"{body['protected']}.{body['payload']}".encode(), ec.ECDSA(hashes.SHA256()))
        payload = json.loads(_b64d(body["payload"])) if body["payload"] else None
        return protected, payload, kid

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path == "/dir":
            return httpx.Response(200, json={"newNonce": f"{self.BASE}/nonce", "newAccount": f"{self.BASE}/acct", "newOrder": f"{self.BASE}/order"})
        if request.method == "HEAD" and path == "/nonce":
            return httpx.Response(200, headers={"Replay-Nonce": self._nonce()})
        if self.bad_nonce_once:
            self.bad_nonce_once = False
            return self._problem("badNonce", "stale nonce")
        try:
            protected, payload, kid = self._verify(request)
        except LookupError:
            return self._problem("badNonce", "unknown nonce")
        if path == "/acct":
            jwk = protected["jwk"]
            key = ec.EllipticCurvePublicNumbers(int.from_bytes(_b64d(jwk["x"]), "big"), int.from_bytes(_b64d(jwk["y"]), "big"), ec.SECP256R1()).public_key()
            assert payload["termsOfServiceAgreed"] is True
            url = f"{self.BASE}/acct/{self._next()}"
            self.accounts[url] = key
            return self._reply(201, {"status": "valid"}, location=url)
        assert kid in self.accounts, "requests after newAccount use kid"
        if path == "/order":
            order_id = self._next()
            names = [i["value"] for i in payload["identifiers"]]
            authz_urls = []
            for name in names:
                authz_id = self._next()
                self.authzs[authz_id] = {"status": "pending", "identifier": {"type": "dns", "value": name}, "kid": kid,
                                         "challenges": [{"type": "http-01", "url": f"{self.BASE}/chal/{authz_id}/http", "token": "h"},
                                                        {"type": "dns-01", "url": f"{self.BASE}/chal/{authz_id}", "token": f"tok{authz_id}", "status": "pending"}]}
                authz_urls.append(f"{self.BASE}/authz/{authz_id}")
            self.orders[order_id] = {"status": "pending", "names": names, "authorizations": authz_urls, "finalize": f"{self.BASE}/finalize/{order_id}"}
            return self._reply(201, self._order(order_id), location=f"{self.BASE}/orders/{order_id}")
        if path.startswith("/authz/"):
            return self._reply(200, self.authzs[path.rsplit("/", 1)[1]])
        if path.startswith("/chal/"):
            authz = self.authzs[path.split("/")[2]]
            name = authz["identifier"]["value"]
            token = authz["challenges"][1]["token"]
            expected = dns01_value(token, _private_for(self.accounts[kid]))
            seen = self.dns.txt.get(f"_acme-challenge.{name}")
            authz["status"] = "valid" if seen == expected else "invalid"
            if authz["status"] == "invalid":
                authz["challenges"][1]["error"] = {"detail": f"TXT {seen!r} != {expected!r}"}
            return self._reply(200, authz["challenges"][1])
        if path.startswith("/orders/"):
            return self._reply(200, self._order(path.rsplit("/", 1)[1]))
        if path.startswith("/finalize/"):
            order_id = path.rsplit("/", 1)[1]
            order = self.orders[order_id]
            csr = x509.load_der_x509_csr(_b64d(payload["csr"]))
            names = sorted(csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName))
            if names != sorted(order["names"]):
                return self._problem("badCSR", "CSR names differ from the order")
            self.certs[order_id] = self.ca.issue(csr.public_key(), names)
            self.issued += 1
            order["status"] = "valid"
            return self._reply(200, self._order(order_id))
        if path.startswith("/cert/"):
            return self._reply(200, text=self.certs[path.rsplit("/", 1)[1]])
        return self._problem("malformed", f"unknown {path}", 404)

    def _order(self, order_id: str) -> dict:
        order = self.orders[order_id]
        if order["status"] == "pending" and all(self.authzs[u.rsplit("/", 1)[1]]["status"] == "valid" for u in order["authorizations"]):
            order["status"] = "ready"
        body = {k: v for k, v in order.items() if k != "names"}
        body["identifiers"] = [{"type": "dns", "value": n} for n in order["names"]]
        if order["status"] == "valid":
            body["certificate"] = f"{self.BASE}/cert/{order_id}"
        return body


_KEYS: dict[bytes, ec.EllipticCurvePrivateKey] = {}


def _private_for(public: ec.EllipticCurvePublicKey) -> ec.EllipticCurvePrivateKey:
    """dns01_value takes a private key; the fake CA looks the account's up by its public key."""
    return _KEYS[public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)]


def _account_key(tmp_path) -> ec.EllipticCurvePrivateKey:
    key = load_or_create_key(tmp_path / "acme-account.pem")
    _KEYS[key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)] = key
    return key


def _acme(fake: FakeAcme, key) -> AcmeClient:
    return AcmeClient(f"{FakeAcme.BASE}/dir", key, httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)), poll_interval=0.01)


def _csr(names: list[str], key=None) -> tuple[str, Any]:
    key = key or ec.generate_private_key(ec.SECP256R1())
    request = x509.CertificateSigningRequestBuilder().subject_name(x509.Name([])).add_extension(x509.SubjectAlternativeName([x509.DNSName(n) for n in names]), critical=False).sign(key, hashes.SHA256())
    return request.public_bytes(serialization.Encoding.PEM).decode(), key


# ---- SNI ----


def _client_hello(name: str) -> bytes:
    context = ssl.create_default_context()
    incoming, outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
    tls = context.wrap_bio(incoming, outgoing, server_hostname=name)
    with pytest.raises(ssl.SSLWantReadError):
        tls.do_handshake()
    return outgoing.read()


def test_sni_reads_the_name_from_a_real_client_hello():
    hello = _client_hello(f"{GW}.r.test")
    assert sni.server_name(hello) == f"{GW}.r.test"
    with pytest.raises(sni.NeedMore):
        sni.server_name(hello[:40])
    with pytest.raises(ValueError):
        sni.server_name(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
    # The same ClientHello split over two TLS records.
    payload = hello[5:]
    cut = len(payload) // 2
    split = b"\x16\x03\x01" + cut.to_bytes(2, "big") + payload[:cut] + b"\x16\x03\x01" + (len(payload) - cut).to_bytes(2, "big") + payload[cut:]
    assert sni.server_name(split) == f"{GW}.r.test"


# ---- ACME client ----


async def test_acme_client_issues_through_dns01(tmp_path):
    ca, dns = TestCA(), FakeDns()
    fake = FakeAcme(ca, dns)
    client = _acme(fake, _account_key(tmp_path))
    names = [f"{GW}.gw.test", f"{GW}.r.test"]
    csr_pem, key = _csr(names)
    fake.bad_nonce_once = True  # the first refusal is retried with a fresh nonce
    chain = await client.issue(x509.load_pem_x509_csr(csr_pem.encode()).public_bytes(serialization.Encoding.DER), names, dns)
    leaf = x509.load_pem_x509_certificate(chain.encode())
    assert sorted(leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)) == names
    assert leaf.public_key().public_numbers() == key.public_key().public_numbers()
    assert sorted(dns.deleted) == [f"_acme-challenge.{n}" for n in names] and dns.txt == {}


async def test_acme_client_reports_a_failed_validation(tmp_path):
    ca, dns = TestCA(), FakeDns()
    fake = FakeAcme(ca, dns)
    client = _acme(fake, _account_key(tmp_path))

    class WrongDns(FakeDns):
        async def set_txt(self, name: str, value: str) -> str:
            return await super().set_txt(name, "not-the-value")

    wrong = WrongDns()
    fake.dns = wrong
    csr_pem, _ = _csr([f"{GW}.r.test"])
    with pytest.raises(AcmeError, match="Validation failed"):
        await client.issue(x509.load_pem_x509_csr(csr_pem.encode()).public_bytes(serialization.Encoding.DER), [f"{GW}.r.test"], wrong)
    assert wrong.txt == {}  # cleaned up even after a failure


# ---- the relay's issuer ----


@pytest.fixture
async def issuer(tmp_path):
    db = Database(tmp_path / "relay.db")
    await db.open()
    for statement in TLS_SCHEMA:
        await db.execute(statement)
    ca, dns = TestCA(), FakeDns()
    fake = FakeAcme(ca, dns)
    yield TlsIssuer(db, lan_zone="gw.test", remote_zone="r.test", dns=dns, acme=_acme(fake, _account_key(tmp_path))), fake, dns
    await db.close()


async def test_issuer_checks_names_reuses_and_rate_limits(issuer):
    tls, fake, dns = issuer
    both = [f"{GW}.gw.test", f"{GW}.r.test"]
    csr_pem, key = _csr(both)
    first = await tls.certificate(GW, csr_pem, "192.168.1.20")
    assert first["names"] == {"lan": f"{GW}.gw.test", "remote": f"{GW}.r.test"} and not first["reused"]
    assert dns.a == {f"{GW}.gw.test": "192.168.1.20"}
    again = await tls.certificate(GW, _csr(both, key)[0], "192.168.1.20")
    assert again["reused"] and again["certificate"] == first["certificate"] and fake.issued == 1
    # Someone else's names, an extra name, or a home name with no home address: refused.
    for names, lan_ip in ((["other.r.test"], None), (both + ["evil.example.com"], "192.168.1.20"), (both, None)):
        with pytest.raises(TlsRefused) as refused:
            await tls.certificate(GW, _csr(names)[0], lan_ip)
        assert refused.value.status == 403
    # A gateway with no home network gets only the remote name.
    remote_only = await tls.certificate("11111111-2222-4333-8444-555555555555", _csr(["11111111-2222-4333-8444-555555555555.r.test"])[0], None)
    assert remote_only["names"]["lan"] is None
    # New keys each time: issued until the weekly cap.
    for _ in range(3):
        await tls.certificate(GW, _csr(both)[0], "192.168.1.20")
    with pytest.raises(TlsRefused) as capped:
        await tls.certificate(GW, _csr(both)[0], "192.168.1.20")
    assert capped.value.status == 429


async def test_issuer_moves_the_home_name_and_only_to_private_addresses(issuer):
    tls, _, dns = issuer
    assert await tls.address(GW, "192.168.1.30") == f"{GW}.gw.test" and dns.a[f"{GW}.gw.test"] == "192.168.1.30"
    for bad in ("8.8.8.8", "127.0.0.1", "not an ip", None):
        with pytest.raises(TlsRefused):
            await tls.address(GW, bad)


async def test_relay_tls_routes_need_the_gateway_secret_and_a_zone(settings, tmp_path):
    plain = create_relay_app(replace(settings, data_dir=tmp_path / "plain", relay_enroll_token="t"))
    async with plain.router.lifespan_context(plain), httpx.AsyncClient(transport=httpx.ASGITransport(app=plain), base_url="http://relay") as client:
        assert (await client.get("/relay/v1/tls")).status_code == 501
    with pytest.raises(SystemExit, match="CLOUDFLARE"):
        create_relay_app(replace(settings, data_dir=tmp_path / "x", relay_tls_remote_zone="r.test"))
    app = create_relay_app(replace(settings, data_dir=tmp_path / "zoned", relay_enroll_token="t", relay_tls_remote_zone="r.test", cloudflare_api_token="x"))
    async with app.router.lifespan_context(app), httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://relay") as client:
        assert (await client.get("/relay/v1/tls")).status_code == 401
        assert (await client.get("/relay/v1/tls", headers={"Authorization": f"Bearer {GW}.wrong"})).status_code == 401


# ---- end to end: client -> relay pass-through -> tunnel -> gateway HTTPS ----


@pytest.fixture
async def tls_stack(settings, tmp_path, monkeypatch):
    relay_port, passthrough_port = _free_port(), _free_port()
    relay_settings = replace(
        settings, data_dir=tmp_path / "relay", host="127.0.0.1", relay_enroll_token="enrol-secret", relay_tls_remote_zone="r.test",
        relay_tls_lan_zone="gw.test", relay_tls_port=passthrough_port, cloudflare_api_token="test",
    )
    relay_app = create_relay_app(relay_settings)
    ca, dns = TestCA(), FakeDns()
    fake = FakeAcme(ca, dns)
    relay_app.state.relay.tls.dns = dns
    relay_app.state.relay.tls.acme = _acme(fake, _account_key(tmp_path))
    relay_server = await _serve(relay_app, relay_port)
    gateway_settings = replace(settings, tls_port=0)
    gateway = Gateway(gateway_settings, registry=AdapterRegistry(AdapterContext(gateway_settings), modules=[]), mdns=FakeMdns())  # type: ignore[arg-type]
    app = create_app(gateway_settings, gateway)
    gateway.app = app
    app.state.gw = gateway
    monkeypatch.setattr(gateway, "address", lambda: "192.168.50.10")
    await gateway.start()
    await enroll(gateway, f"http://127.0.0.1:{relay_port}", "enrol-secret")
    for _ in range(100):
        if gateway.relay and gateway.relay.connected:
            break
        await asyncio.sleep(0.05)
    try:
        yield gateway, relay_app, ca, dns, passthrough_port
    finally:
        await gateway.stop()
        relay_server.should_exit = True
        await asyncio.sleep(0.2)


async def _https(port: int, name: str, ca: TestCA, method: str = "GET", path: str = "/api/v1/health", body: dict | None = None) -> tuple[int, dict, x509.Certificate]:
    context = ssl.create_default_context(cadata=ca.pem())
    reader, writer = await asyncio.open_connection("127.0.0.1", port, ssl=context, server_hostname=name)
    payload = json.dumps(body).encode() if body is not None else b""
    writer.write(f"{method} {path} HTTP/1.1\r\nHost: {name}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode() + payload)
    await writer.drain()
    raw = await asyncio.wait_for(reader.read(), 10)
    peer = x509.load_der_x509_certificate(writer.get_extra_info("ssl_object").getpeercert(binary_form=True))
    writer.close()
    head, _, rest = raw.partition(b"\r\n\r\n")
    status = int(head.split(b" ")[1])
    if b"transfer-encoding: chunked" in head.lower():
        chunks, data = b"", rest
        while data:
            size_line, _, data = data.partition(b"\r\n")
            size = int(size_line, 16)
            if size == 0:
                break
            chunks, data = chunks + data[:size], data[size + 2 :]
        rest = chunks
    return status, json.loads(rest or b"{}"), peer


async def test_end_to_end_encrypted_through_the_relay(tls_stack):
    gateway, relay_app, ca, dns, passthrough_port = tls_stack
    gid = gateway.security.gateway_id
    await gateway.tls.refresh()
    assert gateway.tls.cert_names == [f"{gid}.gw.test", f"{gid}.r.test"] and gateway.tls.port
    assert dns.a == {f"{gid}.gw.test": "192.168.50.10"}
    health = gateway.tls.public()
    assert health["remote_url"] == f"https://{gid}.r.test" and health["lan_url"] is None  # loopback-only listener in this test
    gateway.tls.names["remote_port"] = 8444  # a pass-through exposed on its own port
    assert gateway.tls.public()["remote_url"] == f"https://{gid}.r.test:8444"
    gateway.tls.names["remote_port"] = 443

    # Watch what crosses the relay: it must only ever see ciphertext.
    tunnel = relay_app.state.relay.tunnels[gid]
    seen: list[bytes] = []
    original = tunnel.send

    async def spy(frame: dict) -> None:
        if frame.get("t") == "tcp_data":
            seen.append(base64.b64decode(frame["data"]))
        await original(frame)

    tunnel.send = spy  # type: ignore[method-assign]
    status, body, peer = await _https(passthrough_port, f"{gid}.r.test", ca)
    assert status == 200 and body["data"]["gateway_id"] == gid and body["data"]["tls"]["remote_url"] == f"https://{gid}.r.test"
    assert f"{gid}.r.test" in peer.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    sent = b"".join(seen)
    assert sent and b"HTTP/1.1" not in sent and b"/api/v1/health" not in sent

    # Through the relay, even encrypted, nobody can claim the gateway; on the home network (direct) the owner can.
    code = gateway.security.setup_code
    status, body, _ = await _https(passthrough_port, f"{gid}.r.test", ca, "POST", "/api/v1/auth/claim", {"setup_code": code, "client_name": "outsider"})
    assert status == 403 and body["error"]["code"] == "forbidden"
    status, body, _ = await _https(gateway.tls.port, f"{gid}.gw.test", ca, "POST", "/api/v1/auth/claim", {"setup_code": code, "client_name": "owner"})
    assert status == 201 and body["data"]["client"]["role"] == "owner"
    assert gateway.relay.callers == {}  # every relayed connection's entry is gone once it closes

    # A name for another gateway, or outside the zone, goes nowhere.
    for name in ("11111111-2222-4333-8444-555555555555.r.test", "example.com"):
        with pytest.raises((ssl.SSLError, ConnectionError, OSError, asyncio.IncompleteReadError)):
            await _https(passthrough_port, name, ca)


async def test_a_renewed_certificate_is_served_without_a_restart(tls_stack):
    gateway, _, ca, _, _ = tls_stack
    gid = gateway.security.gateway_id
    await gateway.tls.refresh()
    _, _, before = await _https(gateway.tls.port, f"{gid}.gw.test", ca)
    assert not gateway.tls.needs_certificate([f"{gid}.gw.test", f"{gid}.r.test"])
    key = load_or_create_key(gateway.tls.key_path)
    gateway.tls._install(ca.issue(key.public_key(), [f"{gid}.gw.test", f"{gid}.r.test"], days=20))
    gateway.tls._reload()
    _, _, after = await _https(gateway.tls.port, f"{gid}.gw.test", ca)
    assert after.serial_number != before.serial_number


def test_renewal_is_due_in_the_last_third(settings, tmp_path):
    from cube_gateway.tls import TlsManager

    class G:
        pass

    g = G()
    g.settings = replace(settings, data_dir=tmp_path)  # type: ignore[attr-defined]
    tls = TlsManager(g)  # type: ignore[arg-type]
    names = [f"{GW}.r.test"]
    assert tls.needs_certificate(names)  # none yet
    now = dt.datetime.now(dt.UTC).timestamp()
    tls.cert_names, tls.not_before, tls.not_after = names, now - 10 * 86400, now + 80 * 86400
    assert not tls.needs_certificate(names) and not tls.needs_certificate([])
    tls.not_after = now + 20 * 86400  # 30 days of 90 left -> renew
    tls.not_before = now - 70 * 86400
    assert tls.needs_certificate(names)
    tls.not_after, tls.not_before = now + 60 * 86400, now - 30 * 86400
    assert tls.needs_certificate(names + [f"{GW}.gw.test"])  # a name it doesn't cover yet


async def test_pass_through_takes_the_caller_from_a_trusted_proxy_only():
    from cube_gateway.relay.server import _trusted_proxy
    from cube_gateway.relay.tls import PassThrough

    hello = _client_hello(f"{GW}.r.test")
    passthrough = PassThrough(None, remote_zone="r.test", host="127.0.0.1", port=0, trusted_proxy=_trusted_proxy)  # type: ignore[arg-type]

    def reader(data: bytes) -> asyncio.StreamReader:
        stream = asyncio.StreamReader()
        stream.feed_data(data)
        stream.feed_eof()
        return stream

    proxied = b"PROXY TCP4 93.184.216.7 10.0.0.1 5555 443\r\n" + hello
    data, caller, name = await passthrough._hello(reader(proxied), "127.0.0.1")
    assert (caller, name, data) == ("93.184.216.7", f"{GW}.r.test", hello)
    with pytest.raises(ValueError):  # from the internet, a PROXY line is just not TLS
        await passthrough._hello(reader(proxied), "93.184.216.34")
    data, caller, name = await passthrough._hello(reader(hello), "93.184.216.34")
    assert caller == "93.184.216.34" and name == f"{GW}.r.test"
