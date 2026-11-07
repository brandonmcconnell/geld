#!/usr/bin/env python3
"""Tiles a close-up of every flagged point: joins-zoom.py outlines.json master out.svg names…"""
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from joins import STEMS, faults, union, upright  # noqa: E402

data = json.load(open(sys.argv[1]))
master = sys.argv[2]
glyphs = data[master]
if ':italic:' in master:
    glyphs = {k: upright(v) for k, v in glyphs.items()}
tile, cols, half = 180, 8, 2.5
scale = tile / (2 * half)
parts, k = [], 0
for name in sys.argv[4:]:
    if name not in glyphs:
        continue
    outline = union(glyphs[name])
    for kind, value, (x, y) in faults(glyphs[name], STEMS[int(master.split(':')[2])]):
        ox, oy = (k % cols) * tile, (k // cols) * (tile + 16)
        d = "".join("M" + "L".join(f"{ox + (px - x + half) * scale:.1f} {oy + (y - py + half) * scale:.1f}" for px, py in c) + "Z" for c in outline)
        parts.append(f'<svg x="{ox}" y="{oy}" width="{tile}" height="{tile}" overflow="hidden"><rect x="{-ox}" y="{-oy}" width="100%" height="100%"/></svg>')
        parts.append(f'<clipPath id="c{k}"><rect x="{ox}" y="{oy}" width="{tile}" height="{tile}"/></clipPath><rect x="{ox}" y="{oy}" width="{tile}" height="{tile}" fill="#f4f4f4"/><path clip-path="url(#c{k})" d="{d}" fill="#000"/>')
        parts.append(f'<circle cx="{ox + tile / 2}" cy="{oy + tile / 2}" r="8" fill="none" stroke="#e00" stroke-width="2"/>')
        parts.append(f'<text x="{ox + 4}" y="{oy + tile + 12}" font-size="11" fill="#444" font-family="monospace">{name} {kind} {value:.2f}</text>')
        k += 1
rows = (k + cols - 1) // cols
open(sys.argv[3], "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{cols * tile}" height="{rows * (tile + 16)}"><rect width="100%" height="100%" fill="#fff"/>{"".join(p for p in parts if not p.startswith("<svg"))}</svg>')
