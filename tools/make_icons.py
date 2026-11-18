#!/usr/bin/env python3
"""Make the PNG app icons (no Pillow needed: pure Python + zlib).

Run from anywhere:  python3 tools/make_icons.py

Writes into icons/:
  apple-touch-icon.png   180x180  (iPhone Home Screen)
  icon-192.png           192x192
  icon-512.png           512x512
  icon-maskable-512.png  512x512  (artwork shrunk into the Android safe zone, square background)

The design matches icons/icon.svg: green rounded square, three white rising
bars, and a gold coin. Takes a few seconds.
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

GREEN = (0x04, 0x78, 0x57)
WHITE = (0xFF, 0xFF, 0xFF)
GOLD = (0xF5, 0x9E, 0x0B)
PALE = (0xFD, 0xE6, 0x8A)
BARS = [(96, 316, 80, 100), (216, 256, 80, 160), (336, 196, 80, 220)]


def in_round_rect(x, y, rx, ry, w, hgt, r):
    if not (rx <= x <= rx + w and ry <= y <= ry + hgt):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + hgt - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def color_at(x, y, square_bg):
    if not square_bg and not in_round_rect(x, y, 0, 0, 512, 512, 96):
        return None  # transparent corner
    d2 = (x - 160) ** 2 + (y - 168) ** 2
    if d2 <= 68 ** 2:
        if 38 ** 2 <= d2 <= 50 ** 2:
            return PALE
        return GOLD
    for bx, by, bw, bh in BARS:
        if in_round_rect(x, y, bx, by, bw, bh, 12):
            return WHITE
    return GREEN


def render(size, scale=1.0, ss=3, square_bg=False):
    rows = []
    step = 512 / size
    offs = [(i + 0.5) / ss for i in range(ss)]
    n = ss * ss
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for oy in offs:
                for ox in offs:
                    x = (px + ox) * step
                    y = (py + oy) * step
                    if scale != 1.0:
                        x = 256 + (x - 256) / scale
                        y = 256 + (y - 256) / scale
                    c = color_at(x, y, square_bg)
                    if c is None:
                        continue
                    r += c[0]
                    g += c[1]
                    b += c[2]
                    a += 255
            cov = a / 255
            if cov:
                row += bytes((round(r / cov), round(g / cov), round(b / cov), round(a / n)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)


def main():
    OUT.mkdir(exist_ok=True)
    jobs = [
        # Apple fills transparency with black, so the touch icon uses a full square.
        ("apple-touch-icon.png", 180, 1.0, True),
        ("icon-192.png", 192, 1.0, False),
        ("icon-512.png", 512, 1.0, False),
        ("icon-maskable-512.png", 512, 0.8, True),
    ]
    for name, size, scale, square in jobs:
        write_png(OUT / name, size, render(size, scale, square_bg=square))
        print("wrote", (OUT / name).relative_to(OUT.parent))


if __name__ == "__main__":
    main()
