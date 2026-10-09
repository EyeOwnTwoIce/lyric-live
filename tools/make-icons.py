#!/usr/bin/env python3
"""Genera los iconos PNG de la app sin dependencias externas.

Uso:  python3 tools/make-icons.py

Escribe icons/icon-180.png, icons/icon-192.png y icons/icon-512.png.
Dibujo: cuadrado redondeado con degradado oscuro y barras tipo onda de audio.
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SIZES = [180, 192, 512]

BG_TOP = (19, 25, 38)
BG_BOTTOM = (11, 15, 24)
ACCENT = (76, 201, 240)
ACCENT_2 = (123, 97, 255)


def blend(base, top, alpha):
    return tuple(int(round(base[i] * (1 - alpha) + top[i] * alpha)) for i in range(3))


def rounded_mask(x, y, size, radius):
    """Cobertura 0..1 de un cuadrado redondeado con antialiasing simple."""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    dx = x - cx
    dy = y - cy
    dist = math.hypot(dx, dy)
    if dist <= radius - 0.5:
        return 1.0
    if dist >= radius + 0.5:
        return 0.0
    return radius + 0.5 - dist


def build(size):
    radius = size * 0.22
    pixels = bytearray(size * size * 4)

    bars = 5
    bar_w = size * 0.085
    gap = size * 0.045
    total = bars * bar_w + (bars - 1) * gap
    start_x = (size - total) / 2
    heights = [0.30, 0.58, 0.86, 0.52, 0.34]

    for y in range(size):
        for x in range(size):
            cov = rounded_mask(x, y, size, radius)
            idx = (y * size + x) * 4
            if cov <= 0:
                continue
            t = y / max(1, size - 1)
            r, g, b = blend(BG_TOP, BG_BOTTOM, t)

            # Barras de la onda.
            for i in range(bars):
                bx = start_x + i * (bar_w + gap)
                if bx <= x < bx + bar_w:
                    h = heights[i] * size
                    y0 = (size - h) / 2
                    y1 = y0 + h
                    if y0 <= y <= y1:
                        ratio = i / max(1, bars - 1)
                        cr = int(ACCENT[0] * (1 - ratio) + ACCENT_2[0] * ratio)
                        cg = int(ACCENT[1] * (1 - ratio) + ACCENT_2[1] * ratio)
                        cb = int(ACCENT[2] * (1 - ratio) + ACCENT_2[2] * ratio)
                        r, g, b = cr, cg, cb

            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = int(round(cov * 255))
    return pixels


def write_png(path, size, pixels):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtro None
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return out

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(path, size, build(size))
        print(f"escrito {path}")


if __name__ == "__main__":
    main()
