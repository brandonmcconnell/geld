#!/usr/bin/env python3
"""Draws flagged glyphs (merged outline, faults circled in red) as SVG: joins-sheet.py outlines.json master out.svg names…"""
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from joins import STEMS, faults, union, upright  # noqa: E402

data = json.load(open(sys.argv[1]))
glyphs = data[sys.argv[2]]
if ':italic:' in sys.argv[2]:
    glyphs = {k: upright(v) for k, v in glyphs.items()}
names = [n for n in sys.argv[4:] if n in glyphs]
cell, cols = int(__import__("os").environ.get("CELL", 260)), int(__import__("os").environ.get("COLS", 9))
scale = cell / 24
parts = []
for i, name in enumerate(names):
    ox = (i % cols) * cell + cell * 0.2
    oy = (i // cols) * cell + cell * 0.72
    d = "".join("M" + "L".join(f"{ox + x * scale:.1f} {oy - y * scale:.1f}" for x, y in c) + "Z" for c in union(glyphs[name]))
    parts.append(f'<path d="{d}" fill="#000" fill-rule="nonzero"/>')
    for kind, value, (x, y) in faults(glyphs[name], STEMS[int(sys.argv[2].split(':')[2])]):
        color = {"ledge": "#e00", "short": "#f80", "spike": "#a0f"}[kind]
        parts.append(f'<circle cx="{ox + x * scale:.1f}" cy="{oy - y * scale:.1f}" r="7" fill="none" stroke="{color}" stroke-width="2"/>')
    parts.append(f'<text x="{ox}" y="{oy + cell * 0.22}" font-size="13" fill="#666" font-family="monospace">{name}</text>')
rows = (len(names) + cols - 1) // cols
open(sys.argv[3], "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{cols * cell}" height="{rows * cell}"><rect width="100%" height="100%" fill="#fff"/>{"".join(parts)}</svg>')
