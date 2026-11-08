"""Checks the compiled fonts against dist/manifest.json, which the build writes from the TypeScript source.

Fails (exit 1) when a font's advances, character map, decoration metrics, italic flags, overlap
flags or HarfBuzz shaping differ from the source, or when Geld Dark Sans and Geld Sans differ in width.
"""

import io
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import glyphsets
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

DIST = Path(__file__).resolve().parent.parent / "dist"
OVERLAP_SIMPLE = 0x40
SAMPLE = "HOnoGELD"
CHAR_NAMES = {"-": "hyphen", "=": "equal", "<": "less", ">": "greater"}
# Google Fonts' glyph sets the fonts must cover in full; each is added here once it is complete.
GLYPHSETS = ["GF_Latin_Kernel", "GF_Latin_Core", "GF_Latin_Plus", "GF_Latin_Vietnamese", "GF_Latin_PriAfrican", "GF_Latin_African", "GF_Latin_Beyond", "GF_TransLatin_Pinyin", "GF_TransLatin_Arabic", "GF_Greek_Core", "GF_Cyrillic_Core", "GF_Cyrillic_Plus", "GF_Phonetics_IPAStandard", "GF_Phonetics_APA"]

failures: list[str] = []
# The source name of each glyph shipped under a production name (ufo.ts productionNames), for the font being checked.
SOURCE_NAMES: dict[str, str] = {}


def source(name: str) -> str:
    return SOURCE_NAMES.get(name, name)


def use_names(expected: dict) -> None:
    SOURCE_NAMES.clear()
    SOURCE_NAMES.update({shipped: name for name, shipped in expected.get("productionNames", {}).items()})


def check(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def advances(font: TTFont) -> dict[str, int]:
    return {source(name): font["hmtx"][name][0] for name in font.getGlyphOrder()}


def check_tables(path: Path, font: TTFont) -> None:
    """What every shipped font carries: valid PostScript glyph names, Geld's vendor ID and no component built on a
    composite; the variable fonts their instance name prefix, the static TTFs their hinting (D18) and nothing else."""
    bad = [n for n in font.getGlyphOrder() if not re.fullmatch(r"[A-Za-z_.][A-Za-z0-9_.]*", n)]
    check(not bad, f"{path.name}: invalid glyph names {bad[:5]}")
    check(font["OS/2"].achVendID == "GELD", f"{path.name}: vendor ID {font['OS/2'].achVendID!r}")
    check("STAT" in font and {r.AxisTag for r in font["STAT"].table.DesignAxisRecord.Axis} == {"wght", "ital"}, f"{path.name}: no STAT with weight and italic")
    if "glyf" in font:
        glyf = font["glyf"]
        nested = [n for n in font.getGlyphOrder() if glyf[n].isComposite() and any(glyf[c.glyphName].isComposite() for c in glyf[n].components)]
        check(not nested, f"{path.name}: nested components in {nested[:5]}")
    if "fvar" in font:
        check(bool(font["name"].getDebugName(25)), f"{path.name}: no variations PostScript name prefix")
    hinted = "fpgm" in font
    check(hinted == (path.parent.name == "ttf"), f"{path.name}: hinted is {hinted}")
    if hinted:
        check(bool(font["head"].flags & 1 << 3), f"{path.name}: hinted without whole-pixel ppem (head flags bit 3)")
    elif "glyf" in font:
        check("prep" in font and "gasp" in font, f"{path.name}: unhinted without smart dropout control")


def check_static(path: Path, expected: dict, italic: bool) -> None:
    use_names(expected)
    font = TTFont(path)
    check_tables(path, font)
    check(advances(font) == expected["advances"], f"{path.name}: advances differ from the source")
    cmap = {f"{k:04X}": source(v) for k, v in font.getBestCmap().items()}
    check(cmap == expected["cmap"], f"{path.name}: character map differs from the source")
    post, os2 = font["post"], font["OS/2"]
    check(post.underlinePosition == expected["underlinePosition"], f"{path.name}: underline position")
    check(post.underlineThickness == expected["decorationThickness"], f"{path.name}: underline thickness")
    check(os2.yStrikeoutPosition == expected["strikeoutPosition"], f"{path.name}: strikeout position")
    check(os2.yStrikeoutSize == expected["decorationThickness"], f"{path.name}: strikeout size")
    check(bool(os2.fsSelection & 1) == italic, f"{path.name}: italic bit")
    check((post.italicAngle != 0) == italic, f"{path.name}: italic angle")
    check(bool(os2.fsSelection & 0x80), f"{path.name}: USE_TYPO_METRICS")
    widths = advances(font)
    for name in ("f_f", "f_t", "t_t"):
        letters = sum(widths[part] for part in name.split("_"))
        check(widths[name] == letters, f"{path.name}: {name} is {widths[name]} wide, its letters {letters}")


def check_kerning(path: Path, data: bytes, weight: int, expected: dict) -> None:
    """Each sample pair moves by the source's kerning, resolved through its classes and exceptions (Dark Sans shares Sans's)."""
    chars = {source(name): chr(code) for code, name in TTFont(path).getBestCmap().items()}
    for pair, want in expected.items():
        first, second = pair.split(" ")
        tabular = first.endswith(".tf")
        text = chars[first.removesuffix(".tf")] + chars[second.removesuffix(".tf")]
        widths = []
        for kern in (True, False):
            names, total = shape_total(data, weight, text, {"kern": kern, "tnum": tabular})
            check(names == [first, second], f"{path.name} at {weight}: {pair} shaped {names}")
            widths.append(total)
        got = widths[0] - widths[1]
        check(abs(got - want) <= 1, f"{path.name} at {weight}: {pair} kerned {got}, source {want}")


def shape_total(data: bytes, weight: int, text: str, features: dict | None = None) -> tuple[list[str], int]:
    """Shaped glyph names and total advance, unkerned unless asked: the advances alone."""
    font = hb.Font(hb.Face(data))
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": False} if features is None else features)
    names = [source(font.glyph_to_string(info.codepoint)) for info in buf.glyph_infos]
    return names, sum(pos.x_advance for pos in buf.glyph_positions)


def shape(data: bytes, weight: int, text: str, language: str | None = None, features: dict | None = None):
    font = hb.Font(hb.Face(data))
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    if language:
        buf.language = language
    hb.shape(font, buf, features or {})
    return [(source(font.glyph_to_string(i.codepoint)), p) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def check_marks(path: Path, data: bytes, weight: int) -> None:
    """Accents compose where a precomposed glyph exists, and otherwise attach by anchor: above, below, flatter on capitals, i dotless."""
    expected = {
        "a\u0301": ["aacute"],
        "x\u0301": ["x", "acutecomb"],
        "X\u0301": ["X", "acutecomb.case"],
        "i\u030b": ["dotlessi", "hungarumlautcomb"],
        "x\u0302\u0301": ["x", "circumflexcomb_acutecomb"],
        "X\u0302\u0301": ["X", "circumflexcomb_acutecomb.case"],
        "\u1ea5": ["acircumflexacute"],
        "x\u0327": ["x", "cedillacomb"],
        "a\u030f": ["adblgrave"],
        "x\u030f": ["x", "dblgravecomb"],
    }
    for text, names in expected.items():
        got = shape(data, weight, text)
        check([n for n, _ in got] == names, f"{path.name} at {weight}: {text!r} shaped {[n for n, _ in got]}")
    mark = shape(data, weight, "x\u0301")[-1][1]
    check(mark.y_offset > 500, f"{path.name} at {weight}: acutecomb not raised above x ({mark.y_offset})")
    overlay = shape(data, weight, "x\u0335")[-1][1]
    check(150 < overlay.y_offset < 350, f"{path.name} at {weight}: short stroke overlay not across the middle of x ({overlay.y_offset})")
    below = shape(data, weight, "x\u0327")[-1][1]
    check(below.y_offset <= 0, f"{path.name} at {weight}: cedilla raised ({below.y_offset})")


def check_locl(path: Path, data: bytes, italic: bool) -> None:
    """Bulgarian, Serbian and Macedonian text takes its own Cyrillic forms, and Russian keeps the default."""
    expected = {
        ("ru", "длий"): ["de-cy", "el-cy", "ii-cy", "iibreve-cy"],
        ("bg", "гдлийѝ"): ["ge-cy.loclBGR", "de-cy.loclBGR", "el-cy.loclBGR", "ii-cy.loclBGR", "iibreve-cy.loclBGR", "iigrave-cy.loclBGR"],
        ("sr", "гдпт"): ["ge-cy.loclSRB", "de-cy.loclSRB", "pe-cy.loclSRB", "te-cy.loclSRB"],
        ("mk", "гдпт"): ["ge-cy", "de-cy.loclSRB", "pe-cy.loclSRB", "te-cy.loclSRB"],
    }
    for (language, text), names in expected.items():
        got = [n for n, _ in shape(data, 400, text, language)]
        check(got == names, f"{path.name}: {language} {text!r} shaped {got}")


def check_figures(path: Path, data: bytes) -> None:
    """Every figure feature reaches its glyphs, and the tabular ones share one width."""
    expected = [
        ("10", {"tnum": True}, ["one.tf", "zero.tf"]),
        ("30", {"onum": True}, ["three.osf", "zero.osf"]),
        ("30", {"onum": True, "tnum": True}, ["three.tosf", "zero.tosf"]),
        ("0", {"zero": True}, ["zero.zero"]),
        ("0", {"zero": True, "tnum": True}, ["zero.tf.zero"]),
        ("$5", {"tnum": True}, ["dollar.tf", "five.tf"]),
        ("1/2", {"frac": True}, ["onesuperior", "fraction", "two.dnom"]),
        ("12", {"sups": True}, ["onesuperior", "twosuperior"]),
        ("2+", {"sinf": True}, ["twoinferior", "plusinferior"]),
        ("1o", {"ordn": True}, ["one", "ordmasculine"]),
        ("1o", {}, ["one", "o"]),
    ]
    for text, features, names in expected:
        got = [n for n, _ in shape(data, 400, text, features=features)]
        check(got == names, f"{path.name}: {text!r} with {features} shaped {got}")
    widths = {pos.x_advance for _, pos in shape(data, 400, "0123456789$€", features={"tnum": True})}
    check(len(widths) == 1, f"{path.name}: tabular widths differ {sorted(widths)}")


def check_small_caps(path: Path, data: bytes) -> None:
    """Every GF Latin Core letter has a small capital under smcp (lowercase) and c2sc (capitals); Turkish i keeps its dot."""
    letters = [chr(c) for c in sorted(glyphsets.unicodes_per_glyphset("GF_Latin_Core")) if chr(c).isalpha() and chr(c).isascii() or 0xC0 <= c <= 0x17F]
    for feature, test in (("smcp", str.islower), ("c2sc", str.isupper)):
        missing = [ch for ch in letters if test(ch) and ch not in "ʼŉſ" and not all(n.endswith(".sc") for n, _ in shape(data, 400, ch, features={feature: True}))]
        check(not missing, f"{path.name}: {feature} lacks small capitals for {''.join(missing)}")
    got = [n for n, _ in shape(data, 400, "i", "tr", {"smcp": True})]
    check(got == ["idotaccent.sc"], f"{path.name}: Turkish smcp i shaped {got}")
    got = [n for n, _ in shape(data, 400, "1&", features={"c2sc": True})]
    check(got == ["one.sc", "ampersand.sc"], f"{path.name}: c2sc 1& shaped {got}")


def check_ligatures(path: Path, data: bytes, weight: int) -> None:
    """ff ft tt become one glyph by default, as wide as the letters set apart, with a caret between them; liga off or smcp keeps the letters. "Geld" as a word becomes the wordmark under dlig."""
    font = TTFont(path)
    carets = font["GDEF"].table.LigCaretList
    with_carets = set(carets.Coverage.glyphs) if carets else set()
    for text in ("ff", "ft", "tt"):
        name = "_".join(text)
        joined, width = shape_total(data, weight, text, {"kern": False})
        check(joined == [name], f"{path.name} at {weight}: {text} shaped {joined}")
        apart, apart_width = shape_total(data, weight, text, {"kern": False, "liga": False})
        check(apart == list(text), f"{path.name} at {weight}: {text} without liga shaped {apart}")
        # varLib rounds deltas solved through neighbouring masters, so each advance may drift a unit (statics are exact).
        check(abs(width - apart_width) <= len(text), f"{path.name} at {weight}: {name} is {width} wide, its letters {apart_width}")
        check(name in with_carets, f"{path.name}: {name} has no ligature caret")
        small = [n for n, _ in shape(data, weight, text, features={"smcp": True})]
        check(small == [f"{c}.sc" for c in text], f"{path.name} at {weight}: smcp {text} shaped {small}")
    for text, features, names in (
        ("Geld", {"dlig": True}, ["G_e_l_d"]),
        ("Geld!", {"dlig": True}, ["G_e_l_d", "exclam"]),
        ("Geldern", {"dlig": True}, list("Geldern")),
        ("Geld", {}, list("Geld")),
        ("act", {"hlig": True}, ["a", "c_t"]),
        ("first", {"hlig": True}, ["f", "i", "r", "s_t"]),
        ("aspen", {"hlig": True}, ["a", "s_p", "e", "n"]),
        ("act", {}, ["a", "c", "t"]),
        ("std::x", {"dlig": True}, ["s", "t", "d", "colon.c_coco1", "colon.c_coco2", "x"]),
    ):
        got = [n for n, _ in shape(data, weight, text, features=features)]
        check(got == names, f"{path.name} at {weight}: {text} with {features} shaped {got}")
    check("G_e_l_d" in with_carets, f"{path.name}: the Geld lockup has no carets")
    # Arrows (D12): pieces as wide as the arrow they draw, whole sequences only, ss20 and calt off give the characters back.
    for text, names, like in (
        ("->", ["hyphen.arrow_start", "greater.arrow_head"], "→"),
        ("<-", ["less.arrow_head", "hyphen.arrow_end"], "←"),
        ("=>", ["equal.arrow_start", "greater.arrow_dblhead"], "⇒"),
        ("<->", ["less.arrow_head", "hyphen.arrow_middle", "greater.arrow_head"], None),
        ("==>", ["equal.arrow_start", "equal.arrow_middle", "greater.arrow_dblhead"], None),
        ("->>", ["hyphen.arrow_start", "greater.arrow_inner", "greater.arrow_head"], None),
        ("<<-", ["less.arrow_head", "less.arrow_inner", "hyphen.arrow_end"], None),
    ):
        got, width = shape_total(data, weight, text, {"kern": False})
        check(got == names, f"{path.name} at {weight}: {text} shaped {got}")
        if like:
            _, want = shape_total(data, weight, like, {"kern": False})
            check(abs(width - want) <= len(text), f"{path.name} at {weight}: {text} is {width} wide, {like} {want}")
    for text in ("<=", "<=>", "--->", "-->>", ">>", ">=", "=>="):
        got, _ = shape_total(data, weight, text, {"kern": False})
        check(got == [CHAR_NAMES[c] for c in text], f"{path.name} at {weight}: {text} shaped {got}")
    for features in ({"ss20": True}, {"calt": False}):
        got, _ = shape_total(data, weight, "->", {"kern": False, **features})
        check(got == ["hyphen", "greater"], f"{path.name} at {weight}: -> with {features} shaped {got}")


def check_code_ligatures(path: Path, data: bytes, weight: int, cases: list[dict]) -> None:
    """Every code ligature becomes its pieces under its feature (dlig, or ss10 for dashes), narrower than the
    characters set apart, and stays as typed without it; the stylistic sets take only their own group."""
    for case in cases:
        text = case["text"]
        got, width = shape_total(data, weight, text, {"kern": False, case["feature"]: True})
        check(got == case["pieces"], f"{path.name} at {weight}: {text!r} with {case['feature']} shaped {got}")
        plain, plain_width = shape_total(data, weight, text, {"kern": False})
        check(not any(".c_" in n for n in plain), f"{path.name} at {weight}: {text!r} without features shaped {plain}")
        if case["narrower"]:
            check(width < plain_width, f"{path.name} at {weight}: {text!r} is {width} wide, its characters {plain_width}")
    for text, features, names in (
        ("a<=b", {"ss12": True}, ["a", "less.c_lteq1", "equal.c_lteq2", "b"]),
        ("a&&b", {"ss12": True}, ["a", "ampersand", "ampersand", "b"]),
        ("http://", {"dlig": True}, ["h", "t_t", "p", "colon", "slash", "slash"]),
        ("f(c)", {"dlig": True}, ["f", "parenleft", "c", "parenright"]),
        ("1920x1080", {"dlig": True}, ["one", "nine", "two", "zero", "multiply", "one", "zero", "eight", "zero"]),
        ("A-Z", {}, ["A", "hyphen.case", "Z"]),
        ("a-z", {}, ["a", "hyphen", "z"]),
        ("12:30", {}, ["one", "two", "colon.case", "three", "zero"]),
        ("a:b", {"case": True}, ["a", "colon.case", "b"]),
    ):
        got = [n for n, _ in shape(data, weight, text, features=features)]
        check(got == names, f"{path.name} at {weight}: {text!r} with {features} shaped {got}")


def check_alternates(path: Path, data: bytes, weight: int, cases: list[dict]) -> None:
    """Every alternate under each of its features, its character unchanged without them, an accented letter with its
    base (á under ss01), and every set and cv named in the font for the apps that list them."""
    for case in cases:
        plain = [n for n, _ in shape(data, weight, case["char"])]
        check(plain != [case["glyph"]], f"{path.name} at {weight}: {case['char']} is {case['glyph']} by default")
        for feature in case["features"]:
            got = [n for n, _ in shape(data, weight, case["char"], features={feature: True})]
            check(got == [case["glyph"]], f"{path.name} at {weight}: {case['char']} with {feature} shaped {got}")
    got = [n for n, _ in shape(data, weight, "12", features={"ss17": True})]
    check(got == ["onecircle", "twocircle"], f"{path.name} at {weight}: 12 with ss17 shaped {got}")
    got = [n for n, _ in shape(data, weight, "iä", features={"ss07": True})]
    check(got == ["i.ss07", "adieresis.ss07"], f"{path.name} at {weight}: iä with ss07 shaped {got}")
    # An alternate keeps its octagonal dots whether a set or a cv made it.
    for text, features, names in (("Ï", {"ss03": True, "ss07": True}, ["Idieresis.ss03.ss07"]), ("Ġ", {"cv21": True, "ss07": True}, ["Gdotaccent.cv21.ss07"])):
        got = [n for n, _ in shape(data, weight, text, features=features)]
        check(got == names, f"{path.name} at {weight}: {text} with {features} shaped {got}")
    if any(c["glyph"] == "a.ss01" for c in cases):
        got = [n for n, _ in shape(data, weight, "á", features={"ss01": True})]
        check(got == ["aacute.ss01"], f"{path.name} at {weight}: á with ss01 shaped {got}")
    italic = "Italic" in path.name
    for text, features, names in (
        ("A", {"swsh": True}, ["A.swsh"]),
        ("g", {"swsh": True}, ["g.swsh"]),
        ("l", {"init": True}, ["l.init"]),
        ("n", {"fina": True}, ["n.fina"]),
        ("Mann", {"cswh": True}, ["M.swsh", "a", "n", "n.fina"]),
        ("lane", {"cswh": True}, ["l.init", "a", "n", "e.fina"]),
        ("Kant", {"cswh": True}, ["K", "a", "n", "t.fina"]),
        ("lane", {}, ["l", "a", "n", "e"]),
        ("•", {"ornm": True}, ["ornm01"]),
        ("\ue000\ue001", {}, ["uniE000", "uniE001"]),
        *((("lane", {"ss18": True}, ["l.init", "a", "n", "e.fina"]),) if italic else ()),
    ):
        got = [n for n, _ in shape(data, weight, text, features=features)]
        check(got == names, f"{path.name} at {weight}: {text} with {features} shaped {got}")
    _, plain = shape_total(data, weight, "HH", {"kern": False})
    _, spaced = shape_total(data, weight, "HH", {"kern": False, "cpsp": True})
    check(spaced - plain == 100, f"{path.name} at {weight}: cpsp spaced HH by {spaced - plain}, not 100")
    font = TTFont(path)
    tags = {r.FeatureTag: r.Feature for r in font["GSUB"].table.FeatureList.FeatureRecord}
    for case in cases:
        for feature in case["features"]:
            if feature == "salt":
                continue
            params = tags[feature].FeatureParams
            check(params is not None, f"{path.name}: {feature} has no name for apps to show")


def check_variable(path: Path, by_weight: dict[str, dict], italic: bool) -> None:
    use_names(next(iter(by_weight.values())))
    font = TTFont(path)
    check_tables(path, font)
    cmap = set(font.getBestCmap())
    for name in GLYPHSETS:
        missing = sorted(set(glyphsets.unicodes_per_glyphset(name)) - cmap)
        check(not missing, f"{path.name}: {name} lacks {' '.join(f'U+{c:04X}' for c in missing)}")
    glyf = font["glyf"]
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours > 0:
            check(bool(glyph.flags[0] & OVERLAP_SIMPLE), f"{path.name}: {name} lacks OVERLAP_SIMPLE")
    check("MVAR" in font, f"{path.name}: no MVAR, so decorations do not follow the weight")
    check(bool(font["OS/2"].fsSelection & 1) == italic, f"{path.name}: italic bit")
    data = path.read_bytes()
    check_locl(path, data, italic)
    check_figures(path, data)
    check_small_caps(path, data)
    for weight, expected in by_weight.items():
        instance = instantiateVariableFont(TTFont(path), {"wght": int(weight)})
        got = advances(instance)
        off = [n for n, a in expected["advances"].items() if abs(got.get(n, -9999) - a) > 1]
        check(not off, f"{path.name} at {weight}: advances differ for {off}")
        check_marks(path, data, int(weight))
        names, total = shape_total(data, int(weight), SAMPLE)
        check(names == list(SAMPLE), f"{path.name} at {weight}: shaped {names}")
        want = sum(expected["advances"][c] for c in SAMPLE)
        check(abs(total - want) <= len(SAMPLE), f"{path.name} at {weight}: shaped width {total}, source {want}")
        check_kerning(path, data, int(weight), expected["kerning"])
        check_ligatures(path, data, int(weight))
        check_code_ligatures(path, data, int(weight), expected["codeLigatures"])
        check_alternates(path, data, int(weight), expected["alternates"])


# Words the web subsets are shaped with, each checked in the subsets that hold all of its characters.
SUBSET_WORDS = "-> => ff fi ft Te Ta AV std::x 1/2 <= != www Ġ Łódź Đức ẞ Привет Ђорђе Ωμέγα ἀρχή → ★ ▓ ✓ ⚠ ⇝".split()


def ttf_bytes(path: Path) -> bytes:
    font = TTFont(path)
    font.flavor = None
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def positions(data: bytes, weight: int, text: str, features: dict) -> list[tuple[int, int, int]]:
    font = hb.Font(hb.Face(data))
    font.set_variations({"wght": weight})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features)
    return [(p.x_advance, p.x_offset, p.y_offset) for p in buf.glyph_positions]


def check_subset(path: Path, full: Path, codepoints: list[int], weights: list[int]) -> None:
    """A web subset holds exactly its characters the full font has, carries the full font's tables, and shapes every
    word it can set, with and without dlig, as the full font does."""
    font = TTFont(path)
    check_tables(path, font)
    full_cmap = set(TTFont(full).getBestCmap())
    check(set(font.getBestCmap()) == set(codepoints) & full_cmap, f"{path.name}: characters differ from its subset")
    data, reference = ttf_bytes(path), ttf_bytes(full)
    held = set(font.getBestCmap())
    words = [w for w in SUBSET_WORDS if all(ord(c) in held for c in w)]
    for weight in weights:
        for features in ({}, {"dlig": True}):
            for word in words:
                check(positions(data, weight, word, features) == positions(reference, weight, word, features), f"{path.name} at {weight}: {word} with {features} sets differently from the full font")


def check_css() -> None:
    """Every font the web CSS names exists, and every subset file is served by some CSS."""
    named = set()
    for css in (DIST / "web").glob("*.css"):
        for url in re.findall(r'url\("\./([^"]+)"\)', css.read_text()):
            named.add(url)
            check((DIST / "web" / url).exists(), f"{css.name} names {url}, which was not built")
    subset_files = {entry["file"] for entry in json.loads((DIST / "subsets.json").read_text())["files"]}
    check(subset_files <= named, f"subsets no CSS serves: {sorted(subset_files - named)[:5]}")


def run_check(task: tuple) -> list[str]:
    """One font's checks in a worker process, which hands back what failed."""
    failures.clear()
    kind, path, *args = task
    if kind == "web":
        check_tables(path, TTFont(path))
    elif kind == "subset":
        check_subset(path, *args)
    else:
        {"static": check_static, "variable": check_variable}[kind](path, *args)
    return list(failures)


def main() -> None:
    quick = "--quick" in sys.argv
    jobs = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--jobs=")), os.cpu_count() or 1)
    manifest = json.loads((DIST / "manifest.json").read_text())
    tasks: list[tuple] = []
    for family, styles in manifest.items():
        for style, by_weight in styles.items():
            italic = style == "italic"
            suffix = "-Italic" if italic else ""
            tasks.append(("variable", DIST / "variable" / f"{family}{suffix}[wght].ttf", by_weight, italic))
            if not quick:
                for weight, expected in by_weight.items():
                    for folder, ext in (("ttf", "ttf"), ("otf", "otf")):
                        tasks.append(("static", DIST / folder / f"{expected['postscriptName']}.{ext}", expected, italic))
    if not quick:
        subsets = json.loads((DIST / "subsets.json").read_text())
        subset_files = {entry["file"] for entry in subsets["files"]}
        tasks += [("web", path) for path in sorted((DIST / "web").glob("*.woff2")) if path.name not in subset_files]
        names = {"sans": "GeldSans", "dark": "GeldDarkSans"}
        for entry in subsets["files"]:
            family, style, weight = names[entry["family"]], entry["style"], entry["weight"]
            codepoints = next(s["codepoints"] for s in subsets["subsets"][entry["family"]][style] if s["name"] == entry["subset"])
            if weight == "wght":
                full, weights = DIST / "variable" / f"{family}{'-Italic' if style == 'italic' else ''}[wght].ttf", [100, 400, 900]
            else:
                full, weights = DIST / "web" / f"{manifest[family][style][str(weight)]['postscriptName']}.woff2", [weight]
            tasks.append(("subset", DIST / "web" / entry["file"], full, codepoints, weights))
    if not quick:
        check_css()
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        found = [f for result in pool.map(run_check, tasks) for f in result]
    failures.clear()
    failures.extend(found)
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
    print(f"Fonts match the source ({len(tasks)} fonts{', variable only' if quick else ''}).")


if __name__ == "__main__":
    main()
