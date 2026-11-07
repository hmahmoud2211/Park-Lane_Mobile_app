"""A small ACME (RFC 8555) client: certificates from Let's Encrypt for gateways, proven with DNS-01.

The relay runs it on a gateway's behalf: the gateway keeps its private key and sends only a CSR, the relay proves
control of the names by publishing `_acme-challenge` TXT records (relay/dns.py) and hands back the certificate.

Requests are JWS-signed with the relay's ES256 account key (RFC 7515 / 7518: the signature is r||s, 32 bytes each,
not DER). Every POST carries a fresh nonce; a `badNonce` error is retried once with the nonce it returns.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Protocol

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

log = logging.getLogger("cube.relay.acme")
LETS_ENCRYPT = "https://acme-v02.api.letsencrypt.org/directory"
LETS_ENCRYPT_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory"
#: How long one issuance may take in all (DNS propagation plus validation plus finalisation).
ISSUE_TIMEOUT = 240.0


class AcmeError(Exception):
    def __init__(self, message: str, problem: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.problem = problem or {}


class DnsChallenges(Protocol):
    """Publishes and removes the TXT records that prove control of a name (relay/dns.py)."""

    async def set_txt(self, name: str, value: str) -> Any: ...

    async def delete(self, record: Any) -> None: ...

    async def wait_visible(self) -> None: ...


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def load_or_create_key(path: Path) -> ec.EllipticCurvePrivateKey:
    """The ACME account key (or a gateway's TLS key): EC P-256, created once, mode 0600."""
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError(f"{path} is not an EC private key")
        return key
    path.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(pem)
    return key


def jwk(key: ec.EllipticCurvePrivateKey) -> dict[str, str]:
    numbers = key.public_key().public_numbers()
    return {"crv": "P-256", "kty": "EC", "x": b64url(numbers.x.to_bytes(32, "big")), "y": b64url(numbers.y.to_bytes(32, "big"))}


def thumbprint(key: ec.EllipticCurvePrivateKey) -> str:
    """RFC 7638: SHA-256 over the JWK's required members, sorted, no whitespace."""
    return b64url(hashlib.sha256(json.dumps(jwk(key), sort_keys=True, separators=(",", ":")).encode()).digest())


def dns01_value(token: str, key: ec.EllipticCurvePrivateKey) -> str:
    """What the `_acme-challenge` TXT record must hold (RFC 8555 section 8.4)."""
    return b64url(hashlib.sha256(f"{token}.{thumbprint(key)}".encode()).digest())


def sign(key: ec.EllipticCurvePrivateKey, protected: dict[str, Any], payload: dict[str, Any] | None) -> dict[str, str]:
    """A flattened JWS. `payload` None is a POST-as-GET (empty payload)."""
    header = b64url(json.dumps(protected, separators=(",", ":")).encode())
    body = "" if payload is None else b64url(json.dumps(payload, separators=(",", ":")).encode())
    r, s = decode_dss_signature(key.sign(f"{header}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
    return {"protected": header, "payload": body, "signature": b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}


class AcmeClient:
    def __init__(self, directory_url: str, account_key: ec.EllipticCurvePrivateKey, http: httpx.AsyncClient, *, email: str | None = None, poll_interval: float = 2.0):
        self.directory_url = directory_url
        self.key = account_key
        self.http = http
        self.email = email
        self.poll_interval = poll_interval
        self._directory: dict[str, Any] | None = None
        self._nonce: str | None = None
        self._kid: str | None = None

    async def directory(self) -> dict[str, Any]:
        if self._directory is None:
            response = await self.http.get(self.directory_url)
            response.raise_for_status()
            self._directory = response.json()
        return self._directory

    async def _fresh_nonce(self) -> str:
        if self._nonce:
            nonce, self._nonce = self._nonce, None
            return nonce
        response = await self.http.head((await self.directory())["newNonce"])
        nonce = response.headers.get("Replay-Nonce")
        if not nonce:
            raise AcmeError("The ACME server gave no nonce.")
        return nonce

    async def _post(self, url: str, payload: dict[str, Any] | None, *, use_jwk: bool = False) -> httpx.Response:
        for attempt in range(2):
            protected: dict[str, Any] = {"alg": "ES256", "nonce": await self._fresh_nonce(), "url": url}
            if use_jwk:
                protected["jwk"] = jwk(self.key)
            else:
                protected["kid"] = await self.account()
            response = await self.http.post(url, json=sign(self.key, protected, payload), headers={"Content-Type": "application/jose+json"})
            self._nonce = response.headers.get("Replay-Nonce") or self._nonce
            if response.status_code < 400:
                return response
            problem = _problem(response)
            if problem.get("type") == "urn:ietf:params:acme:error:badNonce" and attempt == 0:
                continue
            raise AcmeError(f"The ACME server refused a request ({response.status_code}): {problem.get('detail') or problem.get('type') or 'no detail'}", problem)
        raise AcmeError("ACME kept refusing the nonce.")  # pragma: no cover - the loop returns or raises

    async def account(self) -> str:
        """Registers the account key (or finds its existing account) and returns the account URL."""
        if self._kid is None:
            payload: dict[str, Any] = {"termsOfServiceAgreed": True}
            if self.email:
                payload["contact"] = [f"mailto:{self.email}"]
            response = await self._post((await self.directory())["newAccount"], payload, use_jwk=True)
            kid = response.headers.get("Location")
            if not kid:
                raise AcmeError("The ACME server gave no account URL.")
            self._kid = kid
        return self._kid

    async def _poll(self, url: str, done: set[str], deadline: float) -> dict[str, Any]:
        while True:
            response = await self._post(url, None)
            body = response.json()
            status = body.get("status")
            if status in done:
                return body
            if status == "invalid":
                detail = _first_error(body)
                raise AcmeError(f"Validation failed: {detail}", body)
            if time.monotonic() > deadline:
                raise AcmeError(f"Timed out waiting for {url} (status {status}).")
            await asyncio.sleep(_retry_after(response, self.poll_interval))

    async def issue(self, csr_der: bytes, names: list[str], dns: DnsChallenges) -> str:
        """Orders a certificate for `names`, proves them with DNS-01 and returns the PEM chain."""
        deadline = time.monotonic() + ISSUE_TIMEOUT
        directory = await self.directory()
        response = await self._post(directory["newOrder"], {"identifiers": [{"type": "dns", "value": name} for name in names]})
        order_url = response.headers.get("Location")
        order = response.json()
        if not order_url:
            raise AcmeError("The ACME server gave no order URL.")
        challenges: list[tuple[str, str]] = []
        records: list[Any] = []
        try:
            for authorization_url in order.get("authorizations", []):
                authorization = (await self._post(authorization_url, None)).json()
                if authorization.get("status") == "valid":
                    continue
                challenge = next((c for c in authorization.get("challenges", []) if c.get("type") == "dns-01"), None)
                if challenge is None:
                    raise AcmeError("The ACME server offered no DNS-01 challenge.")
                name = authorization["identifier"]["value"]
                records.append(await dns.set_txt(f"_acme-challenge.{name}", dns01_value(challenge["token"], self.key)))
                challenges.append((challenge["url"], authorization_url))
            if records:
                await dns.wait_visible()
            for challenge_url, _ in challenges:
                await self._post(challenge_url, {})
            for _, authorization_url in challenges:
                await self._poll(authorization_url, {"valid"}, deadline)
        finally:
            for record in records:
                try:
                    await dns.delete(record)
                except Exception:  # noqa: BLE001 - a leftover TXT record is harmless; issuance shouldn't fail for it
                    log.warning("could not remove an ACME challenge record", exc_info=True)
        order = await self._poll(order_url, {"ready", "valid"}, deadline)
        if order.get("status") == "ready":
            await self._post(order["finalize"], {"csr": b64url(csr_der)})
            order = await self._poll(order_url, {"valid"}, deadline)
        certificate = await self._post(order["certificate"], None)
        return certificate.text


def _problem(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {"detail": response.text[:200]}
    return body if isinstance(body, dict) else {}


def _first_error(body: dict[str, Any]) -> str:
    for challenge in body.get("challenges", []):
        if challenge.get("error"):
            return str(challenge["error"].get("detail") or challenge["error"])
    return str(body.get("error", {}).get("detail") if isinstance(body.get("error"), dict) else body.get("error") or body.get("status"))


def _retry_after(response: httpx.Response, default: float) -> float:
    try:
        return min(10.0, max(0.5, float(response.headers.get("Retry-After", default))))
    except ValueError:
        return default
