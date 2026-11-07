"""The server name (SNI) a TLS client asks for, read from its ClientHello without decrypting anything.

The relay's pass-through listener uses it to pick which gateway's tunnel a connection belongs to; the bytes
themselves go to the gateway untouched, so only the gateway can read them. Layout: RFC 8446 section 4.1.2 (the
ClientHello) and RFC 6066 section 3 (server_name). The ClientHello may span several TLS records (large key shares).
"""

from __future__ import annotations

HANDSHAKE = 0x16
CLIENT_HELLO = 0x01
SERVER_NAME = 0x0000
HOST_NAME = 0x00
#: Refuse anything claiming to be longer than this: real ClientHellos are a few kilobytes.
MAX_HELLO = 32 * 1024


class NeedMore(Exception):
    """The bytes so far end before the ClientHello does: read more and try again."""


def _handshake_bytes(data: bytes) -> bytes:
    """The handshake payload carried by the leading TLS records (record headers removed)."""
    out = bytearray()
    offset = 0
    while offset + 5 <= len(data):
        if data[offset] != HANDSHAKE:
            if not out:
                raise ValueError("not a TLS handshake")
            break
        length = int.from_bytes(data[offset + 3 : offset + 5], "big")
        if offset + 5 + length > len(data):
            out += data[offset + 5 :]
            return bytes(out)
        out += data[offset + 5 : offset + 5 + length]
        offset += 5 + length
        if len(out) >= 4 and len(out) >= 4 + int.from_bytes(out[1:4], "big"):
            break
    if not out and len(data) >= 1 and data[0] != HANDSHAKE:
        raise ValueError("not a TLS handshake")
    return bytes(out)


def server_name(data: bytes) -> str | None:
    """The host name in the ClientHello at the start of `data`, or None when it names none.

    Raises NeedMore when `data` stops before the ClientHello ends, ValueError when it isn't one.
    """
    hello = _handshake_bytes(data)
    if len(hello) < 4:
        raise NeedMore
    if hello[0] != CLIENT_HELLO:
        raise ValueError("not a ClientHello")
    length = int.from_bytes(hello[1:4], "big")
    if length > MAX_HELLO:
        raise ValueError("ClientHello too large")
    if len(hello) < 4 + length:
        raise NeedMore
    body = memoryview(hello)[4 : 4 + length]
    pos = 2 + 32  # client_version, random
    try:
        pos += 1 + body[pos]  # session id
        pos += 2 + int.from_bytes(body[pos : pos + 2], "big")  # cipher suites
        pos += 1 + body[pos]  # compression methods
        if pos == len(body):
            return None  # no extensions at all
        end = pos + 2 + int.from_bytes(body[pos : pos + 2], "big")
        pos += 2
        while pos + 4 <= end:
            kind = int.from_bytes(body[pos : pos + 2], "big")
            size = int.from_bytes(body[pos + 2 : pos + 4], "big")
            pos += 4
            if kind == SERVER_NAME:
                inner = pos + 2
                stop = pos + size
                while inner + 3 <= stop:
                    name_type = body[inner]
                    name_len = int.from_bytes(body[inner + 1 : inner + 3], "big")
                    if name_type == HOST_NAME:
                        name = bytes(body[inner + 3 : inner + 3 + name_len]).decode("ascii")
                        return name.rstrip(".").lower() or None
                    inner += 3 + name_len
                return None
            pos += size
    except (IndexError, UnicodeDecodeError) as error:
        raise ValueError("malformed ClientHello") from error
    return None
