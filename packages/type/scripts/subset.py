#!/usr/bin/env python3
"""Cuts fonts into their web subsets: subset.py <jobs.json>

Each job names a font, the WOFF2 to write and the characters it keeps. Every layout feature is kept (the subsetter
keeps the glyphs a kept character's ligatures and alternates reach), and unhinted output takes the smart dropout
control finish.py gives unhinted fonts.
"""

import json
import sys

from fontTools import subset

from finish import smart_dropout


def main() -> None:
    options = subset.Options()
    options.layout_features = ["*"]
    options.layout_scripts = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    options.flavor = "woff2"
    for job in json.loads(open(sys.argv[1]).read()):
        font = subset.load_font(job["font"], options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=job["codepoints"])
        subsetter.subset(font)
        if "fpgm" not in font:
            smart_dropout(font)
        subset.save_font(font, job["out"], options)


if __name__ == "__main__":
    main()
