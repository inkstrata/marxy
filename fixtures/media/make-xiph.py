"""Writes the Ogg and FLAC fixtures, byte for byte, with no encoder: python fixtures/media/make-xiph.py

- chime.flac: half a second of a 440 Hz tone, 8 kHz mono 16-bit, in four verbatim frames (valid FLAC: CRC-8 and
  CRC-16 per frame, STREAMINFO's MD5 of the samples), with a VORBIS_COMMENT block and a PADDING block.
- chime.opus: Ogg Opus, mono, a 312-sample pre-skip, 25 frames of Opus's 3-byte silence (20 ms each), so half a second
  long once the pre-skip is taken off; OpusHead and OpusTags as an encoder writes them.
- chime-headers.ogg: Ogg Vorbis's identification and comment headers as an encoder writes them (44.1 kHz stereo), a
  setup header that is only a stand-in, and pages whose last granule position is 22,050: half a second. It is for
  reading facts from; it does not decode.

The facts each should give are in apps/desktop/src-tauri/src/facts/media/tests.rs.
"""

import hashlib
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent

# ---- Ogg ----------------------------------------------------------------------------------------------------------


def ogg_crc(data):
    crc = 0
    for b in data:
        crc ^= b << 24
        for _ in range(8):
            crc = ((crc << 1) ^ 0x04C11DB7) if crc & 0x80000000 else (crc << 1)
            crc &= 0xFFFFFFFF
    return crc


def ogg_page(serial, seq, granule, packets, bos=False, eos=False):
    """One page holding whole packets (each under 255 * 255 bytes)."""
    lacing = b""
    for p in packets:
        n = len(p)
        lacing += b"\xff" * (n // 255) + bytes([n % 255])
    flags = (0x02 if bos else 0) | (0x04 if eos else 0)
    head = b"OggS" + struct.pack("<BBqIIIB", 0, flags, granule, serial, seq, 0, len(lacing)) + lacing
    page = bytearray(head + b"".join(packets))
    struct.pack_into("<I", page, 22, ogg_crc(page))
    return bytes(page)


def comments(vendor, fields):
    out = struct.pack("<I", len(vendor.encode())) + vendor.encode() + struct.pack("<I", len(fields))
    for f in fields:
        b = f.encode("utf-8")
        out += struct.pack("<I", len(b)) + b
    return out


def opus():
    serial = 0x5EA5
    head = b"OpusHead" + struct.pack("<BBHIhB", 1, 1, 312, 8000, 0, 0)
    tags = b"OpusTags" + comments("make-xiph.py (constructed)", ["TITLE=Chime", "ARTIST=Reader Lab", "DATE=2026"])
    pages = [ogg_page(serial, 0, 0, [head], bos=True), ogg_page(serial, 1, 0, [tags])]
    silence = bytes([0xF8, 0xFF, 0xFE])
    granule, seq = 312, 2
    for k in range(5):
        granule += 5 * 960
        pages.append(ogg_page(serial, seq, granule, [silence] * 5, eos=(k == 4)))
        seq += 1
    (OUT / "chime.opus").write_bytes(b"".join(pages))


def vorbis():
    serial = 0x0B0E
    ident = b"\x01vorbis" + struct.pack("<IBIiiiBB", 0, 2, 44100, 0, 128000, 0, 0xB8, 1)
    comment = b"\x03vorbis" + comments("Xiph.Org libVorbis I 20200704 (stand-in)", [
        "TITLE=Chime", "ARTIST=Reader Lab", "ALBUM=Fixtures", "GENRE=Test", "TRACKNUMBER=3",
        "METADATA_BLOCK_PICTURE=AAAA"]) + b"\x01"
    setup = b"\x05vorbis" + b"\x00" * 16
    pages = [ogg_page(serial, 0, 0, [ident], bos=True), ogg_page(serial, 1, 0, [comment, setup])]
    pages.append(ogg_page(serial, 2, 11025, [b"\x00" * 40]))
    pages.append(ogg_page(serial, 3, 22050, [b"\x00" * 40], eos=True))
    (OUT / "chime-headers.ogg").write_bytes(b"".join(pages))


# ---- FLAC ---------------------------------------------------------------------------------------------------------


def crc8(data):
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def crc16(data):
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x8005) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def flac():
    rate, block, total = 8000, 1000, 4000
    samples = [int(round(12000 * math.sin(2 * math.pi * 440 * n / rate))) for n in range(total)]
    md5 = hashlib.md5(b"".join(struct.pack("<h", s) for s in samples)).digest()
    bits = (rate << 44) | (0 << 41) | (15 << 36) | total
    info = struct.pack(">HH", block, block) + b"\x00" * 6 + struct.pack(">Q", bits) + md5
    vc = comments("make-xiph.py (constructed)", ["TITLE=Chime", "ARTIST=Reader Lab", "DATE=2026-11-09", "COMMENT=A tone, constructed"])

    def block_head(kind, body, last=False):
        return bytes([(0x80 if last else 0) | kind]) + len(body).to_bytes(3, "big") + body

    out = b"fLaC" + block_head(0, info) + block_head(4, vc) + block_head(1, b"\x00" * 64, last=True)
    for k in range(total // block):
        # Fixed block size; block size from the 16 bits at the header's end; 8 kHz; mono; 16 bits a sample.
        head = bytes([0xFF, 0xF8, (0b0111 << 4) | 0b0100, (0b0000 << 4) | (0b100 << 1), k]) + struct.pack(">H", block - 1)
        head += bytes([crc8(head)])
        body = b"\x02" + b"".join(struct.pack(">h", s) for s in samples[k * block:(k + 1) * block])
        frame = head + body
        out += frame + struct.pack(">H", crc16(frame))
    (OUT / "chime.flac").write_bytes(out)


if __name__ == "__main__":
    flac()
    opus()
    vorbis()
    print("wrote chime.flac, chime.opus and chime-headers.ogg in", OUT)
