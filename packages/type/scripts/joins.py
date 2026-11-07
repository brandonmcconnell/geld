#!/usr/bin/env python3
"""
Finds joins that do not meet: unions each glyph's strokes as a renderer would and looks at the
outline for what a clean join never leaves behind — an edge too short to be meant, a little step
between two parallel edges, or a spike sharper than the design's 45° allows.
  python3 scripts/joins.py outlines.json                    # every fault
  python3 scripts/joins.py --baseline joins-baseline.txt outlines.json   # fails on a fault not listed
"""
import json
import math
import sys

import pathops

STEMS = {100: 0.45, 200: 0.8, 300: 1.2, 400: 1.6, 500: 1.8, 600: 2.0, 700: 2.4, 800: 2.85, 900: 3.3}  # mirrors grid.ts
SHORT = 0.45  # grid units, or 60% of the stem where that is less: a stroke end is a stem wide, an inner cut 0.7. A short edge between two convex corners is a blunt end, and counts only under 0.12
LEDGE = 1.2  # (or less at light weights, where a stroke a stem wide is shorter) a short edge with a convex corner at one end and a concave one at the other: a step or shelf where two strokes miss each other (a 45° cut has both corners alike)
SPIKE = 32  # degrees; the sharpest convex corner a 45°-cut design draws on purpose is about 38° (V's join)


def union(contours):
    path = pathops.Path()
    pen = path.getPen()
    for c in contours:
        pen.moveTo(tuple(c[0]))
        for p in c[1:]:
            pen.lineTo(tuple(p))
        pen.closePath()
    path.simplify(fix_winding=True)
    out = []
    for contour in path.contours:
        pts = []
        for verb, args in contour:
            if args:
                pts.append(args[-1])
        clean = []
        for p in pts:
            if not clean or math.dist(clean[-1], p) > 1e-6:
                clean.append(p)
        if len(clean) > 1 and math.dist(clean[0], clean[-1]) < 1e-6:
            clean.pop()
        changed = True
        while changed and len(clean) > 3:
            changed = False
            for k in range(len(clean)):
                a, b, d = clean[k - 1], clean[k], clean[(k + 1) % len(clean)]
                cross = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])
                if abs(cross) < 1e-6 * max(1e-9, math.dist(a, b) * math.dist(b, d)) or abs(cross) < 1e-9:
                    del clean[k]
                    changed = True
                    break
        if len(clean) >= 3:
            out.append(clean)
    return out


def area(c):
    return sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c))) / 2


def designed(p, q):
    """A 45° edge: a cut corner, which the short inner side of a terminal runs into on purpose."""
    angle = math.degrees(math.atan2(q[1] - p[1], q[0] - p[0])) % 90
    return abs(angle - 45) < 0.5


ITALIC_SLOPE, ITALIC_PIVOT = 1 / 7, 5  # mirrors grid.ts and master.ts


def upright(contours):
    """An italic outline unslanted, so its cuts are 45° again."""
    return [[[x - y * ITALIC_SLOPE + ITALIC_SLOPE * ITALIC_PIVOT, y] for x, y in c] for c in contours]


def faults(contours, stem=2.0):
    found = []
    outline = union(contours)
    outer = 1 if outline and area(max(outline, key=lambda c: abs(area(c)))) > 0 else -1
    for c in outline:
        n = len(c)
        orient = 1 if area(c) > 0 else -1
        ink = orient == outer

        def convex(k):
            a, b, d = c[k - 1], c[k], c[(k + 1) % n]
            return ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])) * orient > 0

        for i in range(n):
            a, b, d = c[i - 1], c[i], c[(i + 1) % n]
            length = math.dist(b, d)
            mixed = convex(i) != convex((i + 1) % n)
            into_cut = False
            if mixed:
                k = (i + 1) % n if convex(i) else i
                beyond = (c[(k + 1) % n], c[k]) if k == (i + 1) % n else (c[k - 1], c[k])
                into_cut = designed(*beyond) or designed(b, d) or designed(a, b) or designed(d, c[(i + 2) % n])
            if 0.01 <= length < min(SHORT, 0.6 * stem) and (length < 0.12 or (mixed and not into_cut) or not (convex(i) or convex((i + 1) % n))):
                found.append(("short", length, b))
            elif length >= 0.01 and length < min(LEDGE, 0.9 * stem + 0.3) and mixed and not into_cut:
                found.append(("ledge", length, b))
            u = (b[0] - a[0], b[1] - a[1])
            v = (d[0] - b[0], d[1] - b[1])
            nu, nv = math.hypot(*u), math.hypot(*v)
            if ink and nu > 1e-9 and nv > 1e-9 and convex(i):
                dot = (u[0] * v[0] + u[1] * v[1]) / (nu * nv)
                interior = 180 - math.degrees(math.acos(max(-1, min(1, dot))))
                if interior < SPIKE:
                    found.append(("spike", interior, b))
    return found


def main():
    args = sys.argv[1:]
    baseline = None
    if args[:1] == ["--baseline"]:
        baseline, args = args[1], args[2:]
    data = json.load(open(args[0]))
    found = {}
    for master, glyphs in data.items():
        for name, contours in sorted(glyphs.items()):
            fs = faults(upright(contours) if ':italic:' in master else contours, STEMS[int(master.split(':')[2])])
            if fs:
                kinds = {}
                for kind, value, at in fs:
                    kinds.setdefault(kind, []).append(f"{value:.2f}@({at[0]:.1f},{at[1]:.1f})")
                found[f"{master} {name}"] = " ".join(f"{k}:{len(v)} {' '.join(v[:3])}" for k, v in kinds.items())
    if baseline is None:
        for key, detail in found.items():
            print(key, detail)
        print("glyphs with faults:", len(found), file=sys.stderr)
        return
    known = {line.strip() for line in open(baseline) if line.strip() and not line.startswith("#")}
    new = sorted(k for k in found if k not in known)
    fixed = sorted(k for k in known if k not in found)
    for key in new:
        print("new fault:", key, found[key])
    if fixed:
        print(f"{len(fixed)} known faults are gone; drop them from {baseline}:", " ".join(fixed))
    if new:
        sys.exit(1)
    print(f"joins: no new faults ({len(known) - len(fixed)} known)")


if __name__ == "__main__":
    main()
