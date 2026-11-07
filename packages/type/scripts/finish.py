"""Finishing touches fontmake leaves out, applied to the variable fonts in place.

Glyphs are drawn as overlapping strokes and keep their overlaps in variable fonts, so each
glyph gets OVERLAP_SIMPLE: without it macOS can render the overlaps with seams. Each also gets
its variations PostScript name prefix.
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
    # The variations PostScript name prefix (name ID 25), from which apps name the instances: GeldSans, GeldSansItalic.
    family = font["name"].getDebugName(16) or font["name"].getDebugName(1)
    italic = bool(font["OS/2"].fsSelection & 1)
    prefix = family.replace(" ", "") + ("Italic" if italic else "")
    font["name"].setName(prefix, 25, 3, 1, 0x409)
    font.save(path)


def hinted(path: str) -> None:
    """A font ttfautohint has hinted rounds its ppem to whole pixels, as its instructions assume (head flags bit 3)."""
    font = TTFont(path)
    font["head"].flags |= 1 << 3
    font.save(path)


if __name__ == "__main__":
    if sys.argv[1] == "--hinted":
        for path in sys.argv[2:]:
            hinted(path)
    else:
        for path in sys.argv[1:]:
            finish(path)
