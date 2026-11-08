# Geld type family: where it stopped and what is left

Written Nov 8, 2026, when the owner paused the type work because of cost.
It is for an agent picking this up in a fresh session, with none of the earlier conversation.
Read it with `AGENTS.md` (the `packages/type/` entry in its Layout section) and the main plan, `.cursor/plans/geld-type-family.plan.md`, whose "Status (Nov 2026)" section agrees with this file.

The original goal: design and build the Geld type family, Geld Sans first and Geld Mono after it.
Both have two corner styles on the brand grid, weights 100 to 900, roman and italic, and a dark grade.
Both need a full character set, spacing and kerning, decoration metrics, text, symbol and code ligatures, and alternates, character variants and swashes.
Everything ships as static, variable and web fonts.
The owner declared Geld Sans done and deferred Geld Mono.
This file lists what Geld Sans still lacks, the joins cleanup in detail, and how to start Geld Mono.

---

## 1. Where things stand

### What exists

`packages/type` (`@geld/type`) builds four families from TypeScript source:

| Family | Corners | Notes |
| --- | --- | --- |
| Geld Sans | square | `Family` `'sans'` |
| Geld Dark Sans | square | `'dark'`, the dark grade: every outline inset by a tenth of the stem, same widths |
| Geld Sans Cut | 45° cuts, the wordmark's | `'sans-cut'` |
| Geld Dark Sans Cut | cut | `'dark-cut'` |

Each family has nine weights (100 to 900) in roman and true italic, as statics (TTF hinted, OTF), variable TTFs (`wght`) and web fonts.
The web fonts are woff2 split by script with `unicode-range`, plus CSS with size-adjusted fallback faces and one class per OpenType feature.
The web package is `@geld/fonts`, rooted at `packages/type/dist/`.
`dist/specimen.html` is a generated specimen with a live tester, and `dist/README.md` is the usage guide.

The last full local build, of the final batch, ended "Fonts match the source (872 fonts)": verify passed, about 25 minutes on 4 cores.
`vitest` passes 51 tests in the type package.
`pnpm joins` reports no new faults (2,984 known).

### Character set

`scripts/verify.py` requires these Google Fonts glyphsets in full, in every font:

- Latin: Kernel, Core, Plus, Vietnamese, PriAfrican, African and Beyond (the glyphsets package has no Latin Pro; Beyond took its place).
- TransLatin: Pinyin and Arabic.
- Greek: Core and Plus, so monotonic and polytonic.
- Cyrillic: Core and Plus.
- Phonetics: IPA Standard and APA.

Also drawn:

- 46 of GF Cyrillic Pro's 54 extra letters, plus yat and big yus (ѣ Ѣ ѫ Ѫ).
- Small capitals, figure sets, fractions, superiors and inferiors.
- Arrows, keyboard keys, math operators, currency, box drawing, geometric shapes and circled numerals ①–⑳.
- The Geld emblem at U+E000 and the "Geld" wordmark as a `dlig` ligature.

A master holds about 3,030 glyphs.

### The PR stack (all open, none merged)

Every PR is based on the one below it, from the plan document up:

```
main
 └ cursor/type-family-plan-fe6c        (the plan)
   └ cursor/geld-sans-foundations-fe6c
     └ cursor/geld-sans-core-fe6c
       └ #464 cursor/geld-sans-weights-fe6c
         └ #465 …italic  └ #467 …latin  └ #468 …latin-ext  └ #469 …latin-plus
           └ #471 …greek-cyrillic  └ #473 …latin-african  └ #475 …figures
             └ #476 …small-caps  └ #482 …kerning  └ #483 …code-ligatures
               └ #485 …alternates  └ #490 …tables-web  └ #492 …cv-more
                 └ #503 cursor/geld-sans-charset-fe6c
                   └ #506 cursor/geld-sans-square-fe6c   ← the tip, everything is here
```

The tip, `cursor/geld-sans-square-fe6c` (#506), holds all the work.
Its last commit is "Close out Geld Sans in the plan and defer Geld Mono" (c4263a98).
#506's CI (`fonts`, `check-and-pack`) was still running when this was written; check it first with `gh pr checks 506`.
Merging the stack is the owner's call.
Work in a new session should branch from #506's tip, or from `main` once the stack has merged.

### What only the owner can do

These block calling Geld Sans shipped:

1. **The licence (D16).** The plan's decision is OFL with a Reserved Font Name. `AGENTS.md` says licence changes are the owner's: an agent may prepare one but never commits it. The `name` table's licence (IDs 13 and 14) and trademark (ID 7) wait on this.
2. **A name-clash check** for "Geld Sans" and "Geld Mono" against existing fonts.
3. **Merging the PR stack.**
4. **Tagging the first release** (`type-v0.1.0` or `type-v1.0.0`). The `release` job in `.github/workflows/type.yml` then zips each family and publishes a GitHub Release (never marked latest; the tag must match `packages/type/package.json`'s version). That also hosts the fonts, which putting the specimen on geld.sh needs.

---

## 2. Working on this package

### Commands (from `packages/type`)

| Command | What it does | Time (4 cores) |
| --- | --- | --- |
| `pnpm build` | Full build: sources, compile (fontc for variable, fontmake for statics), finish, woff2, subsets, ttfautohint, verify | about 25 min |
| `pnpm build --quick` | Variable fonts only, checked | about 8 to 10 min |
| `pnpm test` | vitest (seams, counters, interpolation compatibility, uniqueness, confusables, ligatures, kerning, web) | about 1 min |
| `pnpm typecheck` | tsc | seconds |
| `pnpm joins` | Dumps every master's outlines to `dist/joins.json` and checks them against `scripts/joins-baseline.txt` | about 15 s |

The root `pnpm type:build` runs the package's build.
Python tools are pinned in `packages/type/requirements.txt`: fontTools, fontmake, fontc, ufo2ft, skia-pathops, ttfautohint-py, fontbakery, glyphsets.
CI is `.github/workflows/type.yml` (job `fonts`, plus the `release` job on tags).

### Environment pitfalls found in the last session

- **The cloud VM is suspended while the agent waits on nothing.** A wait not tied to a running shell job (a plain sleep) lets the VM pause. Two 25-minute builds died that way, and another advanced 10 minutes in 25. Run long builds as a background shell job and wait on that job's output (`tail -f log | grep -m1 EXIT`, then wait on that shell), or keep working while they run. Or push and let CI's `fonts` job do the full build.
- **A full build deletes `dist/`, `dist/joins.json` included.** Run `pnpm joins` again after a build before reading joins output.
- **sharp/librsvg drops fills where two edges coincide.** `scripts/sheet.ts` renders with it, and a square P's bowl against its stem rendered without its bottom bar, though the font is right (skia-pathops unions it correctly). `sheet.ts` takes `SVG=/tmp/x.svg` to also write the SVG; render that in Chrome with puppeteer-core, `executablePath: '/usr/local/bin/google-chrome'`, `--no-sandbox`. Install puppeteer-core in a scratch folder under `/tmp`; it is not a repository dependency.
- **The image reader caches by path.** When re-rendering for review, write to a new filename each time.
- **Shaperglot** is not in requirements: `pip install shaperglot`, then run `~/.local/bin/shaperglot report --glyphset GF_Latin_Plus 'dist/variable/GeldSans[wght].ttf'` or `shaperglot check -v <font> el_Grek yo_Latn`.
- **fontc 1.0's limits:** it can't read a discrete axis (the build splits designspaces), it needs integer OS/2 values, and it silently drops GPOS when a PairPos subtable overflows. `scripts/variable.py` falls back to fontmake when GPOS or GSUB is missing. Variable fonts take about 15 minutes each that way, so keep GPOS small (`KERNED_RANGES` in `src/kerning.ts`).

### Repository conventions that apply here

From `AGENTS.md`:

- No `any`, no `as X` casts, TypeScript strict.
- Comments only where the code can't speak for itself, one line usually.
- Commit messages explain why. Create and update PRs only through the PR tool (`gh` is read-only).
- `AGENTS.md` is written one sentence per line (`pnpm docs:lines:check`).
- Licence changes are the owner's.
- A lockfile change on `main` triggers an extension release, so avoid new JS dependencies.

---

## 3. How the source is organised

### Files

| File | Role |
| --- | --- |
| `src/grid.ts` | Units (20-unit em, `UNIT` 50, UPM 1000), `METRICS` (cap 14, x-height 10, ascender 15, descender −4, line 20/−5), stems per weight (`STEMS`), contrast, `ITALIC_SLOPE` 1/7, `DARK_INSET_RATIO` |
| `src/geometry.ts` | The stroke engine: `expandStroke` (centreline to outline), `insertCuts` (45° cuts only at right angles), `withCorners` / `Corners`, `squareStubs`, insets, shear, `bounds`, `winding` |
| `src/draw.ts` | Draw helpers: `p`, `open`, `closed`, `box` (cuts bl, br, tr, tl), `bar`, `stem`, `diagonal`, `vee`, `meeting`, `solid`, `hollow`, `ring`, `octagon`, `mirror`, `rotate`, `rotate180`, `shift`, `comma`, `tildeStroke`, `spanOf` (half a level end's span), `kept()`, the `DrawContext` (`g.y()` is absolute cap units, `g.wide(n)` widths, `g.top/bottom`) |
| `src/glyphs-*.ts` | Glyph definitions by area: core, latin, latin1, african, greek, cyrillic, ipa, figures, symbols, dingbats, arrows, more, plus, smallcaps |
| `src/glyphs.ts` | `GLYPHS`: every drawn def plus alternates, swashes, figure sets, small caps |
| `src/marks.ts` | Combining marks (`MarkDef`: attach `top`/`bottom`/…, `caseForm`, `hang`), `VIETNAMESE_PAIRS`, `GREEK_PAIRS` (two marks side by side as one glyph), tone marks |
| `src/composites.ts` | `accentedFromUnicode` (precomposed letters from Unicode decompositions), `PLACED`, `ALIASES`, `SPACING_ACCENTS` (one or several stacked marks), `GREEK_BESIDE` (polytonic capitals with marks before them), `GREEK_TONOS`, `LATIN_RANGES` |
| `src/master.ts` | `buildMaster(family, style, weight)`: draws every glyph (inside `withCorners`), measures spacing, places marks and composites, builds code ligature pieces, circled numerals and the dark inset. Also `FAMILIES`, `FAMILY_NAMES`, `isDark`, `cornersOf`, `lightOf`, `flatten` |
| `src/spacing.ts` | Sidebearings measured from outlines, so each corner style is spaced for its own corners |
| `src/kerning.ts` | Class kerning measured per corner style on the light grade, shared by its dark grade; `KERNED_RANGES` keeps GPOS small enough for fontc |
| `src/alternates.ts` | `STYLISTIC_SETS`, `ALTERNATES` (cv01–cv39), `SWASHES` |
| `src/code-ligatures.ts` | `CODE_GROUPS` (`dlig` plus ss10–ss16), `CODE_LIGATURES`, `codePieceName` (pieces of a text two groups share carry the group's name) |
| `src/ufo.ts` | UFO writer: font info, features (calt, dlig, ssXX, cvXX, smcp/c2sc, locl, case, frac…), designspaces, production names |
| `src/web.ts` | Web subsets, CSS, feature classes, the package's `package.json` and README (`SIZE_GUIDE`, `APP_GUIDE`) |
| `src/specimen.ts`, `src/proof.ts` | The generated specimen and proof pages |
| `src/lockup.ts` | The wordmark and emblem glyphs, read from `assets/brand/*.svg`, so they stay cut in every family |
| `scripts/build.ts` | Orchestrates everything; families from `FAMILIES` |
| `scripts/verify.py` | Checks every built font against `dist/manifest.json`: glyphsets, tables, names, STAT, hinting flags, kerning samples, shaping, subsets, CSS, the specimen, widths shared by each dark grade and its light grade |
| `scripts/joins.py`, `joins-zoom.py`, `joins-sheet.py` | The joins detector and its close-up sheets (see section 5) |
| `scripts/sheet.ts` | Renders glyphs large from a master: `tsx scripts/sheet.ts out.png <family> <style> <weight> <cell px> names…` |

### Mechanisms a new agent should know

- **Corner styles.** A point's `cut` is `true` (cut in the cut style only), `'keep'` (cut in both styles) or absent. `kept(RIGHT)` and the like turn a box's cuts into kept ones. The square style keeps cuts only where they tell glyphs apart or draw a shape:
  - D's bowl, against O;
  - a single-storey a, ɑ and Ɑ, against o and O;
  - ρ, against p;
  - 0, 5 and 8, against O, S and B;
  - the octagons standing in for circles (○ ● ① ⑩–⑳ © ® ∅);
  - the tildes across letters.

  The test "keep apart in Geld Sans every two letters or figures that Geld Sans Cut keeps apart" rasterises both styles and fails on any newly merged pair. Run it after any change to cuts.
- **`squareStubs`.** In the square style, a terminal that turns at a dropped cut reaches at least 0.6 units past the stroke before it, or it shrinks to a nub. 1.25 units nearly closed apertures in small capitals and superiors.
- **Interpolation compatibility is structural.** Every weight must have the same points, so never add or drop a point at one weight only. The test "draw every weight with the same contours and points" catches it.
- **The dark grade insets outlines.** Two strokes that only touch, or meet edge to edge, part with a sliver in the dark families. Overlap them instead. The seams test catches it.
- **Measure from the light outlines.** Anything measured from outlines to set an advance must read `undarkened` (the light outlines), or the dark grade's widths drift; a test checks they are equal.
- **Composites.** Precomposed letters come from Unicode decompositions. They inherit their base's anchors, each one a stacked mark used raised to where that mark leaves it, so a further mark stacks on (ẹ́, ą́). Greek Extended's oxia letters are canonically the tonos letters and are named `…oxia` so they don't replace ά and the rest. A test checks every master's glyph names are unique.
- **Small capitals** (`glyphs-smallcaps.ts`): the explicit `LETTERS` list plus `moreLetters`, every drawn Latin lowercase whose capital is drawn, except `NO_SMALL_CAP` (ʊ ƀ ǥ ꝉ ɍ ᵽ, whose bars don't fit the x-height at heavy weights). `smcp` maps any lowercase `x` to `x.sc` when that glyph exists.

---

## 4. Geld Sans: what is still open

Many unticked items in the main plan's sections 2 to 9 describe design rules that are already implemented in code, but whose write-up in the plan was never done.
**Before redoing any item, check the code and the built fonts; it may only need ticking with evidence.**
The list below is what is genuinely missing or unverified, as far as the last session knew.

### 4.1 Glyphs

- [ ] **❶–❿ (negative circled numerals).** The figure must be knocked out of a solid octagon.
  - **What failed:** contours alone can't do it, since a digit's strokes overlap: a reversed overlap fills again under nonzero winding. And a union per master risks point structures that differ between weights, which the variable fonts can't take.
  - **Approach 1:** draw these digits as single non-overlapping outlines (one open path each where possible) and reverse them inside the solid octagon.
  - **Approach 2:** union each digit with skia-pathops in a build step over the UFOs, normalise contour order and start points, and let fontmake or fontc check compatibility.
  - **Tests:** add a test that the ten glyphs interpolate.
- [ ] **Eight Cyrillic Pro letters:** Abkhazian Ҩ ҩ Ҽ ҽ Ҿ ҿ and Unicode 16's Ᲊ ᲊ. Find a reference for each form (Unicode charts, Abkhaz typography) rather than guessing. Then add `GF_Cyrillic_Pro` to `GLYPHSETS` in `verify.py`.
- [ ] **Small capitals left out:** ǥ (Finnish and Skolt Sami; Shaperglot counts it against `fi_Latn`), ʊ, ƀ, ꝉ, ɍ and ᵽ. Each needs its capital's bar or counter reworked for the x-height at heavy weights, perhaps a lighter bar or a lower crossing, then removal from `NO_SMALL_CAP`. Run the counter and seams tests after.
- [ ] **Serbian б and Bulgarian з `locl` forms** (plan 3.x, optional by the sources).
- [ ] **Heavy-weight substitutions through `rvrn`** (plan item at line ~170): for example $ with a partial bar from 700 up, where a symbol fills in.

### 4.2 Features and documentation

- [ ] **Case-sensitive forms:** confirm the whole list is covered: ( ) [ ] { } ¡ ¿ « » ‹ › - ‐ – — · • @ and the math operators. `CASE_FORMS` covers dashes and colon; check the rest in a built font with `hb-shape --features=case`.
- [ ] **Guillemets and quote spacing** for French, German and Polish.
- [ ] **Swash rules:** italic swashes and a rule for where `cswh` may place a swash (no swash next to an ascender or descender it would hit).
- [ ] **`titl`**, only if a need shows. `ss19` is reserved.
- [ ] **Lookup order documented** (ss20 and the swash rules depend on it).
- [ ] **Grid spec:** the plan's section 2 rules written up (stroke vocabulary, steep diagonals' slopes, the cut rule and its legs, terminals per glyph family, stem-bowl joins and ink traps, optical corrections). The specimen's Construction section has a summary.
- [ ] **Specimen on geld.sh**, once fonts are hosted (owner's release). `dist/specimen.html` is ready and loads `web/*.css`; the site could serve the release's files or self-host them.
- [ ] **Brand assets regenerated from the font** where they are type (D7). Any change under `assets/brand` triggers an extension release on `main`, so do it deliberately.

### 4.3 QA that was never run

- [ ] **Rendering on real platforms:** macOS (Chrome, Safari, Firefox), Windows (Chrome and Edge, DirectWrite and ClearType), Linux FreeType. Check 11 to 16 px and 20 px, the grid sizes 10/20/30/40 px at 1x and 2x, and Thin at small sizes for dropout. Everything so far ran in headless Chrome on Linux. This needs real machines or a browser-testing service.
- [ ] **fontbakery's Google Fonts profile.** OpenType and Universal pass with no failures. The Google Fonts profile needs the licence names first.
- [ ] **`fontTools varLib.interpolatable`** on the variable fonts (compatibility is structural, but nobody has run it).
- [ ] **Outline checks on statics:** contour direction, stray points, zero-length segments, extreme points.
- [ ] **Kerning collision check** (plan section 4).
- [ ] **diffenator2** between builds.
- [ ] **Shaping tests through harfbuzzjs in vitest.** Each case gives a string, features and the expected glyphs, for every feature, ligature group and `locl` language, with cluster and caret tests. `verify.py` already shapes some samples with HarfBuzz.
- [ ] **SVG snapshots** of glyphs per anchor weight, compared in CI, plus PDF proofs.
- [ ] **App testing:** Figma, Sketch, Illustrator, InDesign, Affinity, Word, Pages, Keynote, and font menus grouping the four families correctly on macOS, Windows and in Adobe apps.
- [ ] **Shaperglot follow-up.** The last run, on GeldSans[wght]:
  - Latin Core 22 of 26 languages supported, the other 4 "nearly" (ŀ, ſ, ǥ small capitals; ŀ and ſ are fixed since);
  - Latin Plus 838 of 1,069 and Latin African 509 of 614: the remaining failures are mostly non-Latin scripts Hyperglot lists, plus missing small capitals;
  - Greek supported;
  - Cyrillic Core 9 of 10 (Bulgarian's auxiliary ѣ ѫ, fixed since) and Cyrillic Plus 37 of 38.

  Re-run on a fresh build, filter to `_Latn`/`_Grek`/`_Cyrl`, and fix what's left.

### 4.4 Tooling

- [ ] Python tools through `uv` in one pinned requirements file, with Shaperglot added.
- [ ] Reproducible builds (byte-identical from the same sources).
- [ ] A browser glyph lab (internal page in `apps/site`), and UFO export for review in Glyphs or RoboFont (D11).
- [ ] fontbakery and shaping tests in CI.
- [ ] **Build time.** A full build is about 25 minutes for four families. Geld Mono's four more would double it. Consider building Sans and Mono as separate targets, and caching masters.

### 4.5 Release and legal (owner first)

- [ ] Licence and RFN, the `name` table's licence and trademark, copyright line and designer credits, contributor terms.
- [ ] First `type-v*` release. Then a version scheme and changelog, and a policy that glyph names and feature tags never change after release.
- [ ] Self-hosted copies on geld.sh, and a Google Fonts submission if the licence allows.

---

## 5. The joins cleanup, in detail

### What the detector checks

`scripts/joins.py` merges each glyph's strokes the way a renderer fills them (skia-pathops union) and looks for what a clean join never leaves.
Italic outlines are sheared upright first.

| Kind | Meaning | Threshold |
| --- | --- | --- |
| `short` | A very short edge: a sliver where two strokes almost meet | under `SHORT` = 0.45 units, or 60% of the stem where less. Between two convex corners (a blunt end) only under 0.12 |
| `ledge` | A short edge with a convex corner at one end and a concave one at the other: a step or shelf where two strokes miss | up to `LEDGE` = 1.2 units (less at light weights). A 45° cut is exempt |
| `spike` | An ink spike | sharper than 32° |

`scripts/joins-baseline.txt` lists every known fault as one line per master and glyph, for example `sans-cut:roman:900 won`.
The `sans-cut:` lines are Geld Sans Cut and the `sans:` lines are Geld Sans (square).
The check runs on the light families only.
`pnpm joins` fails on any fault not in the baseline, and reports known faults that are gone, whose lines should then be dropped.
The baseline holds faults to fix, not approvals, except where a line is noted as kept by design.

**The workflow:**

1. `pnpm joins`, then `python3 scripts/joins.py dist/joins.json` with no baseline to list every fault with its kind, size and position (`kind:count size@(x,y)`).
2. `python3 scripts/joins-zoom.py dist/joins.json sans-cut:roman:900 out.svg glyph…` magnifies each flagged point. Render the SVG in Chrome.
3. Fix the geometry in `src/`, then run `pnpm test`. The seams, counters, interpolation and confusables tests guard against breaking something else.
4. Regenerate the baseline, keeping its header:
   `grep "^#" scripts/joins-baseline.txt > /tmp/jb && python3 scripts/joins.py dist/joins.json 2>/dev/null | awk '{print $1" "$2}' | sort >> /tmp/jb && cp /tmp/jb scripts/joins-baseline.txt`

### How big it is (Nov 8, 2026)

| | Lines | Distinct glyphs | At 800–900 |
| --- | --- | --- | --- |
| Geld Sans Cut (`sans-cut:`) | 952 | 231 | 319 |
| Geld Sans, square (`sans:`) | 2,032 | 292 | 896 |
| Total | 2,984 | | |

Cut-style lines by weight: 100: 62, 200: 69, 300: 66, 400: 63, 500: 97, 600: 127, 700: 149, 800: 171, 900: 148.
They rise sharply from 500 up.

**At Regular roman, the cut style has faults in only 35 glyphs, all rare:**

- hooked African letters (Ɓ Ƈ Ɗ Ɠ Ƙ);
- IPA modifier letters;
- letters with a middle tilde (ɫ ᵴ ꝉ);
- ʒ, ð and ß;
- ⁴ and ¹ (superior, inferior, denominator);
- ø and ɬ as small capitals;
- big yus.

Basic Latin, common accented letters, figures and punctuation are clean at Regular.
Most faults are under 0.3 units (15 font units at 1000 UPM), invisible at text sizes and visible at display sizes, mostly at Bold to Black.

### Where the cut style's faults are, by glyph family (lines across all masters)

- **Marks at heavy weights:** inverted breve (26), the circumflex + hook above pair (10), hook above (8), ogonek (7), the grave-acute-grave tone mark (6). Fix in `src/marks.ts`: the mark pens (`accentPen`, `smallMarkPen`, `chevronPen`) and their geometry at 700 to 900.
- **Tildes:** the tilde mark (18), perispomeni (12, drawn the same as the tilde), tilde below and tilde overlay (6 each), the letters with a middle tilde (ɫ ᵴ ᵵ ᵲ ᵱ ᵰ ᵯ, 6 to 13 each), ~ and ≈. One helper, `tildeStroke` in `draw.ts`, plus the `tilde()` mark and `tildeAcross` in `glyphs-ipa.ts`: **fixing the tilde shape clears dozens of lines at once.** It's the most visible family and the best place to start.
- **Figures:** 4 (18, plus 14 superior and 14 inferior), 1 (13, plus 9 and 9), 6 (11), 9 (11), 2 (10). The small figures inherit from the full ones and the sub-context pens.
- **Currency:** ₩ (12), ₡ (12), ¢ (12), £ (10), ₺ (8). Strokes crossing bars and stems.
- **Ligature-like letters:** Æ and æ (10 and 8), ß and ẞ (10 and 6), ℠ (9).
- **Hooked and stroked letters:** Ƈ Ɠ (8 each), ƙ (6), Ⱥ ⱥ (8 and 9), ħ (8), ǥ (6), ɬ (16), ʡ ʕ (14 and 6), ɞ ɛ ʒ ʓ ɚ and the rest of the IPA hooks.
- **Big yus Ѫ ѫ (34):** the top bar overhangs the V's outer edges by a 0.65-unit shelf (a ledge). Fixing it needs the diagonals to end flush under the bar without meeting it edge to edge, which the seams test forbids. The italic adds a slanted-end mismatch. Small notches show where the V, the Λ and the stem meet.
- **Others:** ¿ and ? (6 each), √ (6), © (7), ұ (8).

### The square style (`sans:` lines)

Most `sans:` lines are ledges where a cut used to stand between two corners.
Examples: e's, c's and s's short terminal stubs, B's step at its waist where its top bowl is narrower, ŋ's hook.
A review of all 1,599 encoded glyphs at Black roman and Regular italic found these read as drawn.
**The ledge threshold was tuned on the cut style, and a square design legitimately has steps and stubs.**

**Options for the square style:**

- **Teach the detector the difference.** For example, don't count a ledge in the square style when it's a terminal stub at least `SQUARE_STUB` long, or a step between two boxes of different widths. Shrinking the baseline honestly that way beats fixing hundreds of glyphs that aren't wrong.
- **Fix the short edges.** The square style had 567 and has 283 since `squareStubs`. About two-thirds are shared with the cut style (tildes, ₩), and fixing the cut style fixes those.
  - **Its own 37:** mostly 0.05 to 0.15 units where a diagonal leaves a box past its square corner (ø as a small capital, q as a small capital).
  - **A few larger:** ß as a small capital (0.4), ₡ (0.38), ƾ (0.44), ɚ (0.34), ẞ (0.21).
  - **Possible fix:** for a diagonal crossing a box near a corner, end it exactly through the outer corner or clearly away from it, in the square style only (`cornersOf(family)` isn't visible to draw code, but the corner style is, through geometry's module state, if a helper needs it).

### Suggested order

1. **The tilde family** (helper-level, the most visible, shared by both styles).
2. **Marks at 700 to 900** (inverted breve, hook above, ogonek, circumflex pairs).
3. **The figures 4, 1, 6, 9, 2** and their small versions.
4. **Currency, Æ/æ, ß** and the hooked letters.
5. **Square-style detector rules,** then its remaining short edges.
6. **Big yus,** if the shelf is judged a fault.

---

## 6. Geld Mono: the deferred goal

### Scope (plan section 19)

A monospaced counterpart to Geld Sans, sharing its grid, stroke engine and character set:

- [ ] **Families:** Geld Mono (square) and Geld Mono Cut, with Geld Dark Mono and Geld Dark Mono Cut. Weights 100 to 900, roman and italic, at one cell width, so bold and italic never change the layout.
- [ ] **The cell:** about 12 units of the 20-unit em (0.6 em). Wide letters (m w M W, and ш щ ж ю on the Cyrillic side) must be compressed into it. Narrow ones (i l j I 1 f r t) need slabs or tails to fill it. Decide this first: it drives every glyph.
- [ ] **Code ligatures on by default**, each as contextual pieces in whole cells, with groups to turn off. Sans already has the machinery (`CODE_LIGATURES`, `codePieceName`, groups `dlig` and ss10–ss16), and the goal wants the coding ligatures in both families. In Mono every piece is exactly one cell wide, which is simpler than Sans's proportional pieces.
- [ ] **Box drawing** (U+2500–257F), **block elements** (U+2580–259F) and **Braille** (U+2800–28FF, generated) filling the cell edge to edge, for terminal UIs. Sans's `BOX_DRAWING` already stands upright in the italic and skips the dark inset (`edgeToEdge` in `master.ts`); reuse that.
- [ ] **Later:** Symbols for Legacy Computing (U+1FB00), Powerline symbols, and whether to support Nerd Fonts patching.
- [ ] **Clear distinctions:** zero slashed by default, I l 1 | told apart, O 0 told apart, a centred `*` and `~`.
- [ ] **Terminal line metrics:** no clipping at the line heights editors use.
- [ ] **Testing in editors and terminals:** VS Code, Zed, JetBrains, Xcode, iTerm2, Ghostty, Kitty, WezTerm, Windows Terminal, Alacritty.

### A possible approach

1. **Decisions first,** recorded in the plan like D1–D18: the cell width, how wide letters compress, slab rules for narrow letters, the Mono names, and whether italic is cursive.
2. **Mono as a mode of the existing engine.** Extend `Family` with the Mono families, or add a separate `Width` dimension: `buildMaster(family, style, weight, width)`. Then:
   - give the `DrawContext` a mono flag and a fixed advance;
   - in `master.ts`, replace measured spacing with centring each glyph in the cell;
   - reuse every glyph definition through `g.wide()` where proportions allow;
   - write Mono-specific definitions (`glyphs-mono.ts`) for letters that need another form (m w M W i l j r f t, @, %).
3. **No kerning in Mono.** Advances are fixed: drop the kern feature and keep `calt` and the code ligatures.
4. **Tests:** add "every glyph is one cell wide" (or zero for marks), and reuse the seams, counters, interpolation, confusables and uniqueness tests.
5. **Build:** four more families double the build time. Make Mono its own build target (`pnpm build --mono`, or a separate designspace set) and add CI time accordingly. Extend `web.ts` and the specimen for Mono.
6. **The character set** first through GF Latin Core and the code-relevant symbols, then extended to match Sans.

---

## 7. Prompts to start a new session

To finish Geld Sans's open work:

> Read `AGENTS.md` (the packages/type entry), `.cursor/plans/geld-type-family.plan.md` and `.cursor/plans/geld-type-future.md`. Branch from the tip of the type PR stack (`cursor/geld-sans-square-fe6c`, PR #506, or `main` if it has merged). Start the joins cleanup in the order in section 5 of the future file, beginning with the tilde family. Run `pnpm test` and `pnpm joins` after each change, and let CI do full builds rather than waiting on long local builds (see section 2's environment pitfalls). Update the baseline and the plan as items close.

To start Geld Mono:

> Read the same three files. Geld Sans is done. Start Geld Mono (section 6 of the future file, section 19 of the plan): first write the Mono decisions (cell width, wide and narrow letter strategy, names, italic) into the plan as decisions and stop for my agreement before drawing glyphs.
