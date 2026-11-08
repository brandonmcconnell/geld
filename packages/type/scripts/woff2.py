#!/usr/bin/env python3
"""Compresses TrueType fonts to WOFF2 in one process: woff2.py <output folder> <font.ttf>...

The web fonts are unhinted (D18), so each takes the smart dropout control finish.py gives unhinted fonts.
"""

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

from finish import smart_dropout

out = Path(sys.argv[1])
for path in map(Path, sys.argv[2:]):
    font = TTFont(path)
    if "fpgm" not in font:
        smart_dropout(font)
    font.flavor = "woff2"
    font.save(out / f"{path.stem}.woff2")
