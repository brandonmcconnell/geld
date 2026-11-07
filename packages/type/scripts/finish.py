"""Finishing touches fontmake leaves out, applied to the variable fonts in place.

Glyphs are drawn as overlapping strokes and keep their overlaps in variable fonts, so each
glyph gets OVERLAP_SIMPLE: without it macOS can render the overlaps with seams.
"""

import sys

from fontTools.ttLib import TTFont

OVERLAP_SIMPLE = 0x40


def finish(path: str) -> None:
    font = TTFont(path)
    glyf = font["glyf"]
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours > 0:
            glyph.flags[0] |= OVERLAP_SIMPLE
    font.save(path)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        finish(path)
