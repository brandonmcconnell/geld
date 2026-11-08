"""Finishing touches fontmake leaves out, applied to the variable fonts in place.

Glyphs are drawn as overlapping strokes and keep their overlaps in variable fonts, so each
glyph gets OVERLAP_SIMPLE: without it macOS can render the overlaps with seams. Each also gets
its variations PostScript name prefix.
"""

import sys

from fontTools.otlLib.builder import buildStatTable
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import ttProgram

OVERLAP_SIMPLE = 0x40


def smart_dropout(font: TTFont) -> None:
    """An unhinted font still asks rasterizers for smart dropout control and smooths at every size, as gftools does,
    so thin strokes keep their pixels at small sizes on Windows."""
    prep = newTable("prep")
    prep.program = ttProgram.Program()
    prep.program.fromAssembly(["PUSHW[]", "511", "SCANCTRL[]", "PUSHB[]", "4", "SCANTYPE[]"])
    font["prep"] = prep
    gasp = newTable("gasp")
    gasp.gaspRange = {0xFFFF: 0x000F}
    font["gasp"] = gasp


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
    smart_dropout(font)
    font.save(path)


WEIGHT_NAMES = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}


def static(path: str) -> None:
    """A static font's STAT names its place in the family, as the variable fonts' does: its weight and whether it is
    italic, Regular elided and linked to Bold, Roman elided and linked to Italic, so apps group the family."""
    font = TTFont(path)
    weight = font["OS/2"].usWeightClass
    italic = bool(font["OS/2"].fsSelection & 1)
    weight_value = {"value": weight, "name": WEIGHT_NAMES[weight]}
    if weight == 400:
        weight_value.update(flags=0x2, linkedValue=700)
    ital_value = {"value": 1, "name": "Italic"} if italic else {"value": 0, "name": "Roman", "flags": 0x2, "linkedValue": 1}
    axes = [
        {"tag": "wght", "name": "Weight", "values": [weight_value]},
        {"tag": "ital", "name": "Italic", "values": [ital_value]},
    ]
    buildStatTable(font, axes, elidedFallbackName="Regular")
    font.save(path)


def hinted(path: str) -> None:
    """A font ttfautohint has hinted rounds its ppem to whole pixels, as its instructions assume (head flags bit 3)."""
    font = TTFont(path)
    font["head"].flags |= 1 << 3
    font.save(path)


if __name__ == "__main__":
    if sys.argv[1] in ("--hinted", "--static"):
        for path in sys.argv[2:]:
            (hinted if sys.argv[1] == "--hinted" else static)(path)
    else:
        for path in sys.argv[1:]:
            finish(path)
