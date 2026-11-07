#!/usr/bin/env python3
"""Compresses TrueType fonts to WOFF2 in one process: woff2.py <output folder> <font.ttf>..."""

import sys
from pathlib import Path

from fontTools.ttLib import woff2

out = Path(sys.argv[1])
for path in map(Path, sys.argv[2:]):
    woff2.compress(str(path), str(out / f"{path.stem}.woff2"))
