#!/usr/bin/env python3
"""Compiles a designspace's variable fonts with fontc: variable.py <designspace> <output folder>

fontc reads no discrete axes, so each of the designspace's variable fonts (one per italic value) is split out as
fontmake splits it, compiled, and given the STAT table fontmake would build from the whole designspace, which links
Roman to Italic. fontc compiles in seconds what takes fontmake a quarter of an hour.

fontc 1.0 drops a layout table whole, saying so only in its debug log, when it cannot repack an offset overflow (the
italic's class kerning, Nov 2026). A font that comes out without GPOS or GSUB is built again with fontmake, which
splits overflowing subtables, and the build says so.
"""

import os
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from pathlib import Path

from fontTools.designspaceLib import DesignSpaceDocument
from fontTools.designspaceLib.split import splitVariableFonts
from fontTools.ttLib import TTFont
from fontTools.varLib.stat import buildVFStatTable


def fontc() -> str:
    for folder in (sysconfig.get_path("scripts"), sysconfig.get_path("scripts", f"{os.name}_user")):
        if (Path(folder) / "fontc").exists():
            return str(Path(folder) / "fontc")
    found = shutil.which("fontc")
    if not found:
        sys.exit("fontc is not installed (pip install -r requirements.txt)")
    return found


def main() -> None:
    space, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    doc = DesignSpaceDocument.fromfile(space)
    for name, part in splitVariableFonts(doc):
        # Beside the original, so the sources' relative paths still hold.
        part_path = space.with_name(f"{name}.variable.designspace")
        part.write(part_path)
        target = out / f"{name}[{','.join(axis.tag for axis in part.axes)}].ttf"
        with tempfile.TemporaryDirectory() as build:
            result = subprocess.run([fontc(), "--build-dir", build, "--output-file", str(target), str(part_path)], capture_output=True, text=True)
        if result.returncode:
            sys.exit(f"fontc failed on {part_path.name}:\n{result.stderr}")
        font = TTFont(target)
        missing = [tag for tag in ("GPOS", "GSUB") if tag not in font]
        if missing:
            print(f"geld: fontc left {' and '.join(missing)} out of {target.name}; building it with fontmake", file=sys.stderr)
            subprocess.run([sys.executable, "-m", "fontmake", "-m", str(part_path), "-o", "variable", "--output-path", str(target)], check=True, capture_output=True)
            font = TTFont(target)
        buildVFStatTable(font, doc, name)
        # fontc signs the version string; the fonts carry the source's own.
        names = font["name"]
        for record in names.names:
            if record.nameID == 5:
                names.setName(record.toUnicode().split(";")[0], 5, record.platformID, record.platEncID, record.langID)
        font.save(target)


if __name__ == "__main__":
    main()
