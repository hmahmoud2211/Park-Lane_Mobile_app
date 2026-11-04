"""Sealing device credentials at rest.

The master key is 32 random bytes in DATA_DIR/secret.key (mode 0600), created on first start. It never
leaves the gateway. Credentials (local keys, TV tokens, device keys) are stored AES-256-GCM sealed, with
the device id as associated data so a sealed blob cannot be moved onto another device's row.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = b"v1"


class Sealer:
    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("the master key must be 32 bytes")
        self._aead = AESGCM(key)

    @classmethod
    def from_file(cls, path: Path) -> Sealer:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            raw = path.read_bytes().strip()
            key = base64.b64decode(raw)
        else:
            key = secrets.token_bytes(32)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(base64.b64encode(key) + b"\n")
        return cls(key)

    def seal(self, value: Any, context: str) -> str:
        nonce = secrets.token_bytes(12)
        plaintext = json.dumps(value, separators=(",", ":")).encode()
        ciphertext = self._aead.encrypt(nonce, plaintext, _VERSION + context.encode())
        return (_VERSION + b"." + base64.urlsafe_b64encode(nonce + ciphertext)).decode()

    def unseal(self, sealed: str, context: str) -> Any:
        version, _, body = sealed.encode().partition(b".")
        if version != _VERSION:
            raise ValueError("unknown sealed format")
        raw = base64.urlsafe_b64decode(body)
        plaintext = self._aead.decrypt(raw[:12], raw[12:], _VERSION + context.encode())
        return json.loads(plaintext)


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def identity_proof(pin_key: bytes, gateway_id: str, nonce: str) -> str:
    """What the gateway answers a client's identity challenge with. The app computes the same with
    expo-crypto (src/services/gateway/hmac.ts); change both together."""
    message = f"cube-gw-v1|{gateway_id}|{nonce}".encode()
    return hmac.new(pin_key, message, hashlib.sha256).hexdigest()
