"""Checks the compiled fonts against dist/manifest.json, which the build writes from the TypeScript source.

Fails (exit 1) when a font's advances, character map, decoration metrics, italic flags, overlap
flags or HarfBuzz shaping differ from the source, or when Geld Dark Sans and Geld Sans differ in width.
"""

import json
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

DIST = Path(__file__).resolve().parent.parent / "dist"
OVERLAP_SIMPLE = 0x40
SAMPLE = "HOnoGELD"

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def advances(font: TTFont) -> dict[str, int]:
    return {name: font["hmtx"][name][0] for name in font.getGlyphOrder()}


def check_static(path: Path, expected: dict, italic: bool) -> None:
    font = TTFont(path)
    check(advances(font) == expected["advances"], f"{path.name}: advances differ from the source")
    cmap = {f"{k:04X}": v for k, v in font.getBestCmap().items()}
    check(cmap == expected["cmap"], f"{path.name}: character map differs from the source")
    post, os2 = font["post"], font["OS/2"]
    check(post.underlinePosition == expected["underlinePosition"], f"{path.name}: underline position")
    check(post.underlineThickness == expected["decorationThickness"], f"{path.name}: underline thickness")
    check(os2.yStrikeoutPosition == expected["strikeoutPosition"], f"{path.name}: strikeout position")
    check(os2.yStrikeoutSize == expected["decorationThickness"], f"{path.name}: strikeout size")
    check(bool(os2.fsSelection & 1) == italic, f"{path.name}: italic bit")
    check((post.italicAngle != 0) == italic, f"{path.name}: italic angle")
    check(bool(os2.fsSelection & 0x80), f"{path.name}: USE_TYPO_METRICS")


def shape_total(data: bytes, weight: int, text: str) -> tuple[list[str], int]:
    font = hb.Font(hb.Face(data))
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    names = [font.glyph_to_string(info.codepoint) for info in buf.glyph_infos]
    return names, sum(pos.x_advance for pos in buf.glyph_positions)


def check_variable(path: Path, by_weight: dict[str, dict], italic: bool) -> None:
    font = TTFont(path)
    glyf = font["glyf"]
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours > 0:
            check(bool(glyph.flags[0] & OVERLAP_SIMPLE), f"{path.name}: {name} lacks OVERLAP_SIMPLE")
    check("MVAR" in font, f"{path.name}: no MVAR, so decorations do not follow the weight")
    check(bool(font["OS/2"].fsSelection & 1) == italic, f"{path.name}: italic bit")
    data = path.read_bytes()
    for weight, expected in by_weight.items():
        instance = instantiateVariableFont(TTFont(path), {"wght": int(weight)})
        got = advances(instance)
        off = [n for n, a in expected["advances"].items() if abs(got.get(n, -9999) - a) > 1]
        check(not off, f"{path.name} at {weight}: advances differ for {off}")
        names, total = shape_total(data, int(weight), SAMPLE)
        check(names == list(SAMPLE), f"{path.name} at {weight}: shaped {names}")
        want = sum(expected["advances"][c] for c in SAMPLE)
        check(abs(total - want) <= len(SAMPLE), f"{path.name} at {weight}: shaped width {total}, source {want}")


def main() -> None:
    manifest = json.loads((DIST / "manifest.json").read_text())
    for family, styles in manifest.items():
        for style, by_weight in styles.items():
            italic = style == "italic"
            for weight, expected in by_weight.items():
                for folder, ext in (("ttf", "ttf"), ("otf", "otf")):
                    check_static(DIST / folder / f"{expected['postscriptName']}.{ext}", expected, italic)
            suffix = "-Italic" if italic else ""
            check_variable(DIST / "variable" / f"{family}{suffix}[wght].ttf", by_weight, italic)
    sans, dark = manifest["GeldSans"], manifest["GeldDarkSans"]
    for style in sans:
        for weight in sans[style]:
            check(
                sans[style][weight]["advances"] == dark[style][weight]["advances"],
                f"Geld Dark Sans {style} {weight} differs in width from Geld Sans",
            )
    if failures:
        print("\n".join(failures))
        sys.exit(1)
    print("Fonts match the source.")


if __name__ == "__main__":
    main()
