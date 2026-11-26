"""Writes the AIFF and Matroska audio demo files, byte for byte, with no encoder: python fixtures/media/make-names.py

- harbor-bell.aiff: half a second of a 440 Hz tone, 8 kHz mono 16-bit big-endian PCM, with NAME and AUTH chunks.
- harbor-bell.mka: Matroska audio, Opus mono at 48 kHz, half a second long by its Info, one Cluster of Opus's 3-byte
  silence frames; the header's facts only, it does not carry a real encode.

The facts each should give are in apps/desktop/src-tauri/src/facts/media/tests.rs and the stand-in's table.
"""

import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "demo" / "media"


def extended(n):
    e = n.bit_length() - 1
    return struct.pack(">HQ", 16383 + e, n << (63 - e))


def chunk(tag, body):
    return tag + struct.pack(">I", len(body)) + body + (b"\0" if len(body) & 1 else b"")


def aiff():
    rate, frames = 8000, 4000
    pcm = b"".join(struct.pack(">h", int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(frames))
    comm = struct.pack(">hIh", 1, frames, 16) + extended(rate)
    body = b"AIFF" + chunk(b"NAME", b"Harbour bell") + chunk(b"AUTH", b"Marxy fixtures") + chunk(b"COMM", comm) + chunk(b"SSND", struct.pack(">II", 0, 0) + pcm)
    return b"FORM" + struct.pack(">I", len(body)) + body


def vint(n):
    for length in range(1, 9):
        if n < (1 << (7 * length)) - 1:
            return (n | (1 << (7 * length))).to_bytes(length, "big")
    raise ValueError(n)


def el(eid, body):
    return eid + vint(len(body)) + body


def uint(n):
    return n.to_bytes(max(1, (n.bit_length() + 7) // 8), "big")


def mka():
    header = el(b"\x1a\x45\xdf\xa3", el(b"\x42\x82", b"matroska") + el(b"\x42\x87", b"\x04") + el(b"\x42\x85", b"\x02"))
    info = el(
        b"\x15\x49\xa9\x66",
        el(b"\x2a\xd7\xb1", uint(1_000_000)) + el(b"\x44\x89", struct.pack(">f", 500.0)) + el(b"\x4d\x80", b"Marxy fixtures") + el(b"\x7b\xa9", b"Harbour bell"),
    )
    audio = el(b"\xe1", el(b"\xb5", struct.pack(">f", 48000.0)) + el(b"\x9f", b"\x01"))
    entry = el(b"\xae", el(b"\xd7", b"\x01") + el(b"\x83", b"\x02") + el(b"\x86", b"A_OPUS") + audio)
    tracks = el(b"\x16\x54\xae\x6b", entry)
    cluster = el(b"\x1f\x43\xb6\x75", el(b"\xe7", b"\x00") + b"".join(el(b"\xa3", b"\x81\x00\x00\x80\xf8\xff\xfe") for _ in range(25)))
    return header + el(b"\x18\x53\x80\x67", info + tracks + cluster)


(OUT / "harbor-bell.aiff").write_bytes(aiff())
(OUT / "harbor-bell.mka").write_bytes(mka())
