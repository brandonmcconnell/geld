---
name: Geld type family
overview: 'Geld Sans (then Geld Mono), drawn on the brand grid: two corner styles (Cut, Square), weights 100 to 900, roman and italic, a dark-mode grade built like the logo''s bands, a high-budget Latin character set, spacing and kerning, OpenType features (text ligatures, symbol and code ligatures, alternates, swashes), symbols, and a tested build that ships static, variable and web fonts.'
status: 'Awaiting alignment. Nothing is drawn until the decisions in section 1 are settled.'
isProject: true
---

# Geld type family

This is the full checklist for Geld Sans, and a preview of Geld Mono, which follows it.
Section 1 lists the decisions to settle before work starts, each with a recommendation.
Sections 2 to 17 are the work itself, as checkboxes.
Section 18 gives the order of the work and what each phase must deliver before the next one starts.

## 0. Where we start from

The wordmark merged in #460 (`assets/brand/geld-logo.svg`) is the first specimen, and every rule below has to reproduce it:

- The grid is the emblem's 24 × 25 units, and at 25px tall 1 unit is 1px.
- Caps are 14 units tall (y 6 to 20) with a 2-unit stroke.
- Cuts are 45°, 2 units on the outer corner and 1 unit on the inner corner.
- **Cuts appear only where a traditional sans has a curve.** G and D have cuts. E and L, and the straight side of D, have square corners. This is the rule that defines the Cut style, and it creates the main problem for the Square style (D1 below).
- The dark-mode logo insets every edge by 0.2 units, so the 2-unit stroke becomes 1.6 at the same widths. That is a grade axis, and the family gets one (2.6).
- Letters in the wordmark have 6 units between them. That is logo tracking, not text spacing.

Exact geometry, for reference: a 45° cut of leg `c` on a stroke of thickness `d` leaves an inner leg of `c − d(2 − √2)`. With c = 2 and d = 2 that is 0.83, which the wordmark snaps to 1.

## 1. Decisions to settle first

Each decision has a recommendation. Agreeing to all the recommendations is a valid answer.

| # | Decision | Recommendation |
|---|---|---|
| D1 | **How Square keeps letters apart.** With every cut squared off, O, D, 0 and □ become rectangles, and C collides with `[`. | Every cut is tagged *decorative* or *structural*. Square removes decorative cuts and keeps structural ones, for example the right-hand corners of D, so O, D and 0 stay distinct. In Square, `0` also takes a slash or dot by default. |
| D2 | **The word for the cut style.** | **Cut** (Geld Sans Cut, Geld Sans Square). It is short, it is the word the brand already uses (`--geld-cut`, "cut corners"), and it pairs with Square. The alternatives are Chamfer (the precise term but technical), Bevel (CSS's `corner-shape: bevel`, but it suggests a 3D edge) and Notch. |
| D3 | **The default family.** Which one does plain "Geld Sans" mean? | Ship two families, **Geld Sans Cut** and **Geld Sans Square**, with Cut as the brand default. Also ship one variable "Geld Sans" file with a corner axis (D4) for anyone who wants both in one file. |
| D4 | **A corner axis.** | Yes. A custom axis `CUTS`, from 0 (Square) to 100 (Cut). It costs almost nothing because the outlines are generated (D11). Cut and Square become named instances of that axis, and the corners can animate between them. |
| D5 | **Units per em and the grid.** | 1 em = 20 grid units and UPM = 1000, so 1 unit = 50 units of the font. At 20px, 1 grid unit is 1px, so every straight edge of the grid weights lands on a pixel. 10px, 30px and 40px land on half or whole pixels. Cap height is 14 units (0.70 em, close to Inter's 0.73). |
| D6 | **Vertical proportions.** | x-height 10 units (0.50 em, 0.71 of cap height: large, for UI), ascender 15, descender 4. These are starting values and are checked in Phase 2 against Inter, Geist and SF at 12 to 16px. |
| D7 | **The wordmark is a weight of the font.** | Yes. "GELD" set in Geld Sans Cut SemiBold (600) with tracking reproduces `geld-logo.svg` exactly, and SemiBold's cap stem is the wordmark's 2 units. |
| D8 | **Italic construction.** | A true italic: the roman sheared on a slanted grid, with corrections, plus italic-only letterforms (single-storey a and g, a descending f, a tailed l, a straight-tailed y, exit strokes on n m h i u l as a stylistic set). It is not a plain oblique. |
| D9 | **Italic angle.** | A slope of 1:7 (8.13°), so a cap's 14 units shift by exactly 2 units and caps stay on the grid. The alternatives are 1:6 (9.46°) and 1:5 (11.31°, where the 10-unit x-height lands on the grid instead). |
| D10 | **Language scope for v1.** | v1 is Latin, to Google Fonts' **GF Latin Pro** glyph set (which includes Vietnamese and African Latin). Greek and Cyrillic follow as v1.1, since the octagonal construction suits Cyrillic especially well. |
| D11 | **How glyphs are made.** | Code first. Each glyph is a skeleton (a centreline on the grid plus per-glyph parameters) written in TypeScript. A geometry engine expands the skeleton to outlines for any weight, grade, corner and slant. Hand corrections are parameters or explicit overrides in the source, never edits made in an editor. UFOs are exported only for review in Glyphs or RoboFont. This keeps the grid exact and makes every weight reproducible. |
| D12 | **Symbol ligatures keep one glyph per character.** | Yes. `->` becomes two contextual pieces (a left half and a right half of the arrow), each as wide as its own character, rather than one ligature glyph. The text stays two characters, the caret, selection and deletion work per character in every app, and it is also how the Mono font has to work. Text ligatures such as `fi` use real ligature glyphs with caret positions. |
| D13 | **Which ligatures are on by default in Sans.** | In `calt` (on by default): only the arrows `->` `<-` `<->` `=>` and their long forms. In `dlig` (off by default): the rest of the code ligatures. An `ss20` "No arrows" set turns the default arrows back into plain characters. Mono (later) turns the code ligatures on by default. |
| D14 | **Small caps in v1.** | Yes, for the GF Latin Core characters with figures and punctuation (`smcp`, `c2sc`). Petite caps are out of scope. |
| D15 | **Optical size axis.** | Not in v1. The construction keeps it possible later, with larger cuts and looser spacing at caption sizes and tighter spacing at display sizes. |
| D16 | **Licence.** | SIL OFL 1.1 with "Geld" as a Reserved Font Name. This is the norm for fonts, and Google Fonts requires it. The rest of the repository is AGPL-3.0-only, and AGPL is an awkward fit for fonts embedded in documents. Licence changes are the owner's (AGENTS.md), so an agent prepares this and the owner commits it. |
| D17 | **Where Geld uses its own font.** | geld.sh, the extension's popup and options pages, store art and the emblem in PUA. The digest on github.com keeps GitHub's font. |
| D18 | **Hinting.** | Variable fonts and web fonts unhinted. Static TTFs hinted with ttfautohint for Windows. |

## 2. Design foundations

### 2.1 Grid and metrics
- [ ] Grid spec document: units, UPM, the snapping rule (grid weights land on whole units, other weights land on 0.05-unit steps), and where half units are allowed.
- [ ] Vertical metrics: cap height, x-height, ascender, descender, overshoot policy (flat octagonal tops need none, diagonal apexes such as A V W need a small one), and the accent zone above caps and above lowercase.
- [ ] Line metrics: `hhea` and `OS/2` typo ascender and descender set equal, line gap 0, `USE_TYPO_METRICS` on, `usWinAscent` and `usWinDescent` covering the tallest stacked Vietnamese accent and the deepest descender so Windows never clips. Default line height about 1.2.
- [ ] Baseline and height alignment across all four styles, so switching style never moves a line.
- [ ] `post.underlinePosition` and `post.underlineThickness`, plus `OS/2` strikeout position and size (2.9).
- [ ] Super and subscript metrics (`ySuperscript*`, `ySubscript*`) matching the `sups` and `subs` glyphs.
- [ ] Recommended pixel sizes documented: 10, 20, 30 and 40px are on the grid.

### 2.2 Construction rules
- [ ] The vocabulary of strokes: vertical, horizontal, 45° diagonal, and the "steep" diagonals A V W X Y K need (slopes on the grid, such as 2:5 and 1:3, listed in the spec).
- [ ] The cut rule: a cut where a curve would be, its leg at each weight, and the inner leg (`c − d(2 − √2)`, snapped).
- [ ] Structural and decorative cuts tagged for every glyph (D1).
- [ ] Terminals: square, cut or diagonal, per glyph family (c e s a r f j t y).
- [ ] Joins: how a stem meets a bowl (n h m u b d p q), with notches or ink traps at heavy weights so joins do not fill in.
- [ ] Diagonal joins (v w x y k) thinned so they look the same weight as stems.
- [ ] Dots and tittles (i j ä ü ! ? ;) as squares, octagons or diamonds, with one default and the rest as alternates (ss07).
- [ ] Accents drawn on the same grid (acute, grave, circumflex, caron, breve, ring, tilde, macron, dieresis, dot, ogonek, cedilla, double acute, horn, hook above, comma below), each with its cap form (`.case`).
- [ ] Optical corrections listed per glyph: horizontals thinner than verticals, crossbars thinner, the round letters a touch wider than straight ones, the diagonals' overshoot.

### 2.3 Weights (100 to 900)
Starting stems in grid units, vertical cap stems, to be tuned in Phase 3:

| wght | Name | Stem | Note |
|---|---|---|---|
| 100 | Thin | 0.45 | |
| 200 | ExtraLight | 0.8 | |
| 300 | Light | 1.2 | |
| 400 | Regular | 1.6 | Same as the dark logo's band |
| 500 | Medium | 1.8 | |
| 600 | SemiBold | 2.0 | The wordmark (D7) |
| 700 | Bold | 2.4 | |
| 800 | ExtraBold | 2.85 | |
| 900 | Black | 3.3 | |

- [ ] Contrast per weight: horizontals about 95% of verticals at Regular, about 80% at Black. Lowercase stems about 95% of cap stems.
- [ ] The three-horizontals budget. e, s, a, g and ≡ put three horizontals inside a 10-unit x-height, so at Black they cannot all be 3.3 units. Rules for how much horizontals thin and how far x-height letters widen, with a minimum counter of 1.5 units.
- [ ] Widths grow with weight (heavier is wider) so counters stay open. The growth curve is set per glyph group.
- [ ] Cuts at heavy weights: the outer leg grows so the inner leg never drops below 0.75 units, or the inner corner stays square, decided per glyph group.
- [ ] Weight distribution with `avar`, so 100 to 900 steps look even.
- [ ] Interpolation compatibility guaranteed by construction: every weight has the same points in the same order.
- [ ] `usWeightClass`, `fsSelection` and style linking for every static instance.

### 2.4 Corner styles: Cut and Square
- [ ] Every glyph has Cut, Square and the axis between them (`CUTS` 0 to 100), with structural cuts kept in Square.
- [ ] A Square-only check of every confusable pair: O 0 D Q, C [, U ⊔, I l 1 |, rn m, cl d, S 5, Z 2, B 8, G 6.
- [ ] Square's default `0` is slashed or dotted (D1). Cut keeps an open zero, with the slashed and dotted zeros on `zero` and `cv`.
- [ ] The emblem drawn in both styles.

### 2.5 Italic
- [ ] The slanted grid at 1:7 (D9). `post.italicAngle`, `hhea` caret slope and `OS/2` fsSelection italic.
- [ ] Cuts on a sheared corner. Shearing makes the top-left and bottom-right corners obtuse and the other two acute, so the cut legs are tuned so both read as the same cut.
- [ ] Italic-only forms (D8): a, g, f, l, y and e, plus exit strokes as `ss08`.
- [ ] Italic spacing and kerning, done separately from roman.
- [ ] Italic swashes (2.8 and section 7).
- [ ] Square italic: parallelograms on the same slanted grid.

### 2.6 Grade (dark mode)
- [ ] `GRAD` axis: stem change in font units at constant width, from −40 to +40. GRAD −20 is the logo's dark treatment (a 0.2-unit inset on each side). Widths, sidebearings and kerning do not change across the axis, so text never reflows when the scheme changes.
- [ ] Named use documented: `@media (prefers-color-scheme: dark) { font-variation-settings: "GRAD" -20 }`.
- [ ] Static "Dark" instances are not shipped. The axis covers it.

### 2.7 Spacing model
- [ ] Sidebearings by side profile, in grid units: straight stems (H, n), cut rounds (O, o, closer to straight than a true curve because the cut is only 2 units), diagonals (V, v), open sides (C right, r right, L right, T), and each punctuation class.
- [ ] Proof the spacing with H, O, n and o control strings before any kerning.
- [ ] Spaces: space, no-break space, en and em space and quad, three-, four- and six-per-em spaces, figure space, punctuation space, thin space, hair space, narrow no-break space, plus zero-width space, ZWJ, ZWNJ, word joiner, soft hyphen and BOM.
- [ ] Tabular widths for figures, currency, math operators, `:` `.` `,` and the figure space.
- [ ] Spacing for `case` forms and small caps.

### 2.8 Swash design language
- [ ] Swashes extend strokes along the grid at 45°: entry strokes on caps, exit strokes on lowercase, long tails (Q, R, K, J, y, g, j).
- [ ] A rule for where a swash may go (no swash next to a descender or ascender it would hit), used by `cswh`.

### 2.9 Underline and strikethrough
These are not font styles. The renderer draws them from metrics the font provides.
- [ ] Underline thickness tracks each weight's horizontal stroke (about 70% of it, clamped to 0.5 to 1.5 units), and strikeout thickness matches it.
- [ ] Underline position clears the baseline by about 1.5 units, above the descender, so `text-decoration-skip-ink` reads well.
- [ ] Strikeout position on the centre of the hyphen and en dash bar, so a struck word lines up with its dashes.
- [ ] Both vary with weight in the variable fonts (`MVAR` tags `unds`, `undo`, `strs`, `stro`).
- [ ] Checked with `text-decoration-thickness: from-font` in Chrome, Safari and Firefox, and in Word, Pages and Google Docs.
- [ ] Documented: renderers draw decorations as rectangles, so they never have cut corners.

## 3. Character set

Targets are Google Fonts' published glyph sets, so coverage is checkable by tool. Every encoded character is drawn in all four styles and every weight. Counts are approximate.

### 3.1 Latin (v1)
- [ ] Basic Latin (U+0020 to 007E), 95 characters.
- [ ] Latin-1 Supplement (U+00A0 to 00FF), 96.
- [ ] Latin Extended-A (U+0100 to 017F), all 128, including Ŀ ŀ ĳ Ĳ ŉ ſ.
- [ ] Latin Extended-B, the GF Latin Pro selection: Ș ș Ț ț, Ə ə, Ɓ ɓ, Ɗ ɗ, Ƴ ƴ, Ɛ ɛ, Ɔ ɔ, Ŋ ŋ, Ɲ ɲ, Ǎ ǎ and the pinyin carons, Ǵ ǵ, Ǹ ǹ, Ǻ ǻ, Ǽ ǽ, Ǿ ǿ and others.
- [ ] Latin Extended Additional: all of Vietnamese (about 200), plus Ẁ ẁ Ẃ ẃ Ẅ ẅ Ỳ ỳ ẞ Ḃ ḃ Ḋ ḋ Ḟ ḟ Ṁ ṁ Ṗ ṗ Ṡ ṡ Ṫ ṫ.
- [ ] IPA and phonetic letters the African and Pro sets need (ɑ ɒ ɡ ɪ ʃ ʊ ʋ ʒ ʔ and others).
- [ ] Spacing modifier letters: ˆ ˇ ˘ ˙ ˚ ˛ ˜ ˝ ˈ ˌ ʹ ʺ ʻ ʼ ʽ.
- [ ] Combining diacritics (U+0300 to 036F), the ones GF Latin Pro lists (about 40), plus U+25CC ◌ for showing a combining mark alone.
- [ ] Language-specific forms (`locl`): Catalan ŀl, Dutch IJ and ij with `IJ`/`ij` acute, Turkish and Azeri i and İ under `smcp` and case mapping, Polish kreska (a steeper acute), Romanian comma-below Ș and Ț, Lithuanian dotted i with accents, Navajo ogonek, and the German ẞ for uppercase.
- [ ] Coverage checked against GF Latin Core, Plus, Pro, African and Vietnamese, and with Shaperglot for every language Hyperglot lists for those sets.

### 3.2 Figures
- [ ] Proportional lining figures (default).
- [ ] Tabular lining (`tnum`).
- [ ] Proportional and tabular oldstyle (`onum`).
- [ ] Superscript, subscript and scientific inferior (`sups`, `subs`, `sinf`) for 0 to 9, + − = ( ) . ,
- [ ] Numerators and denominators (`numr`, `dnom`) and the fraction slash ⁄.
- [ ] Precomposed fractions: ½ ⅓ ⅔ ¼ ¾ ⅕ to ⅞ and ↉.
- [ ] Ordinals ª º and `ordn` for 1st, 2nd, Nº.
- [ ] Zero variants: open, slashed and dotted (`zero`, `cv`).
- [ ] Small-cap figures (`c2sc`).
- [ ] Circled and negative circled numerals ① to ⑳ and ❶ to ❿, decided in Phase 7.

### 3.3 Punctuation
- [ ] All the ASCII and Latin-1 punctuation, plus ‐ ‑ ‒ – — ― ‖ ‘ ’ ‚ ‛ “ ” „ ‟ † ‡ • ‣ ․ ‥ … ‧ ‰ ‱ ′ ″ ‴ ‹ › ※ ‼ ‽ ⁄ ⁎ ⁓ and the interrobang.
- [ ] Case-sensitive forms (`case`): ( ) [ ] { } ¡ ¿ « » ‹ › - ‐ – — · • @ and the math operators raised to cap height.
- [ ] Guillemets and quotes for French, German and Polish quoting styles, spaced properly.

### 3.4 Currency
- [ ] $ ¢ £ ¤ ¥ € ₹ ₽ ₩ ₺ ₴ ₦ ₱ ₫ ₪ ₡ ₸ ₼ ₾ ₿ ₵ ₲ ₭ and the ruble, rupee and other GF Pro symbols.
- [ ] Heavy-weight substitutions where a symbol fills in (for example $ with a partial bar from 700 up), through feature variations (`rvrn`).
- [ ] Tabular forms of every currency sign.

### 3.5 Math and technical symbols
- [ ] Operators: + − × ÷ = ≠ ≈ ≡ ≤ ≥ ± ∓ ¬ ∞ ∂ ∆ ∇ ∏ ∑ √ ∫ ∝ ∠ ∧ ∨ ∩ ∪ ∈ ∉ ∋ ⊂ ⊃ ⊆ ⊇ ⊕ ⊗ ⊥ ∀ ∃ ∅ ∘ ∙ ⋅ ∗ ∕ ′ ″ ‰ µ Ω ℓ °.
- [ ] Letterlike: ℃ ℉ № ℗ ℠ ™ ℮ ℓ Ω ℹ.
- [ ] Keys (macOS and keyboard): ⌘ ⌥ ⌃ ⇧ ⇪ ⇥ ⇤ ⏎ ↩ ⌫ ⌦ ⎋ ⏏ ⌂ ⌀ ⎈ ⏻ ⏼.
- [ ] Geld's UI already prints "⌘ 1-click review", so ⌘ ⌥ ⌃ ⇧ must be drawn to match the letters.

### 3.6 Arrows
- [ ] The Arrows block (U+2190 to 21FF) selection: ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ↩ ↪ ↰ ↱ ↲ ↳ ↴ ↵ ↶ ↷ ↺ ↻ ⇄ ⇅ ⇆ ⇇ ⇈ ⇉ ⇊ ⇐ ⇑ ⇒ ⇓ ⇔ ⇕ ⇠ ⇡ ⇢ ⇣ ⇤ ⇥ ⇦ ⇧ ⇨ ⇩, plus ⟵ ⟶ ⟷ ⟸ ⟹ ⟺ ⤴ ⤵ and ➔.
- [ ] Arrowheads built on the grid's 45°. Every arrow shares one shaft thickness and one head per weight, which is also what the ligated arrows (5.3) use, so a typed `->` and a real → match.

### 3.7 Shapes, marks and dingbats
- [ ] Geometric shapes: ■ □ ▪ ▫ ▬ ▲ △ ▶ ▷ ▼ ▽ ◀ ◁ ◆ ◇ ○ ● ◉ ◌ ◐ ◑ ◒ ◓ ◢ ◣ ◤ ◥, each in a cut version too.
- [ ] Checks and marks: ✓ ✔ ✗ ✘ ✕ ✖ ★ ☆ ☐ ☑ ☒ ♥ ⚑ ⚠.
- [ ] Box drawing and block elements, a basic set in Sans (the full set is Mono's, section 19).
- [ ] Ornaments (`ornm`): the Geld emblem in Cut and Square, cut-corner frames, bullets and grid patterns.
- [ ] Private Use Area: the emblem at U+E000 and the wordmark lockup at U+E001, documented.

### 3.8 Later scripts (v1.1, D10)
- [ ] Greek (GF Greek Core): monotonic, plus polytonic as a later step.
- [ ] Cyrillic (GF Cyrillic Core and Plus), with Bulgarian and Serbian/Macedonian `locl` forms.

## 4. Kerning

- [ ] Kerning groups for both sides of every glyph, derived from side profiles. Alternates, small caps and swashes get their own groups.
- [ ] Class kerning first, then exceptions only where a class cannot be right (for example Tě, ľ, ď, Ť with following lowercase, and Tï).
- [ ] The pairs that matter: caps with caps (AV, LT, TA, VA, AY), caps with lowercase (Ta, Te, To, Tr, Ty, Va, Yo, Fo, P.), lowercase pairs (r, f, v, w, y with punctuation), quotes and apostrophes ("A", L', 'T), punctuation after caps (T, V. F:), figures in proportional mode (11, 17, 71, 1.), slashes and parentheses (/A, (J), and `case` forms.
- [ ] Kerning in quarter grid units (12.5 font units), so values stay on a known subgrid.
- [ ] Kerning per weight, in every corner style and in italic, interpolating cleanly through the variable fonts.
- [ ] Tabular figures and Mono get no kerning, by construction.
- [ ] Collision checks: no kerned pair overlaps, including accents (for example T with ť, Ŵ with ŵ).
- [ ] Space kerning (space with A, T, V, Y, quotes) where it helps.
- [ ] Review with standard kerning test texts across languages, and with Geld's own UI strings.

## 5. Ligatures

### 5.1 Text ligatures
- [ ] Decide per pair whether the octagonal shapes collide at all: f with i, f with l, f with f, f with t, ffi, ffl, f with j, f with b, f with h, f with k, and t with t.
- [ ] Draw ligature glyphs only for the pairs that collide (`liga`), with caret positions in `GDEF` so the cursor can go between the letters.
- [ ] Discretionary ligatures (`dlig`): ct, st, sp and "Geld" to the wordmark lockup.

### 5.2 Ligature mechanics (D12)
- [ ] Symbol and code ligatures are contextual pieces (`calt`), one glyph per character with that character's advance width, so text, selection, the caret and deletion stay per character.
- [ ] Kerning between pieces so the joined shape is continuous.
- [ ] Turning off: `calt` off (CSS `font-variant-ligatures: no-contextual`) removes them all, `ss20` removes only the default arrows (it runs after `calt` and maps the pieces back).
- [ ] Ligatures checked with `letter-spacing` set, since browsers drop optional ligatures when letters are spaced, and the result documented.

### 5.3 Symbol and code ligatures (in Sans and in Mono)

Default in Sans per D13. Mono turns most of them on by default (section 19).

| Group | Sequences | Draws as | Sans | Mono |
|---|---|---|---|---|
| Arrows | `->` `<-` `<->` `-->` `<--` `<-->` `->>` `<<-` | → ← ↔ and long forms | on (`calt`) | on |
| Fat arrows | `=>` `<==` `==>` `<==>` `=>>` | ⇒ ⇐ and long forms | on (`calt`) | on |
| Squiggle arrows | `~>` `<~` `~~>` `<~~` | ⇝ ⇜ | off (`dlig`) | on |
| Comparison | `<=` `>=` `!=` `==` `===` `!==` `=/=` `/=` | ≤ ≥ ≠ and joined equals | off (`dlig`) | on |
| Spaceship | `<=>` | one three-cell symbol, never ⇔ | off (`dlig`) | on |
| Pipes | `\|>` `<\|` `\|\|>` `<\|\|` | ▷ ◁ style | off (`dlig`) | on |
| Logic | `&&` `\|\|` `!!` `??` `?.` `?:` | joined pairs | off (`dlig`) | on |
| Scope and range | `::` `:::` `:=` `=:` `::=` `..` `...` `..<` `..=` | centred, joined | off (`dlig`) | on |
| Comments | `//` `///` `/*` `*/` `/**` `#!` | joined | off (`dlig`) | on |
| Markup | `</` `/>` `</>` `<!--` | joined | off (`dlig`) | on |
| Shifts and bind | `<<` `>>` `<<<` `>>>` `>>=` `=<<` `<<=` | joined | off (`dlig`) | on |
| Increment | `++` `--` `+++` | joined | off (`dlig`) | on |
| Regex and match | `=~` `!~` | joined | off (`dlig`) | on |
| Hash forms | `#{` `#[` `#(` `#?` `#_` | joined | off (`dlig`) | on |
| Repeats | `___` `###` `***` `===` (long runs) | continuous bars | off | on |
| Hex | `0x` | small x between 0 and the digits | off | on (contextual) |

- [ ] Each group as its own stylistic set as well (`ss11` arrows, `ss12` comparison, `ss13` logic, `ss14` comments and markup, `ss15` scope, `ss16` shifts), so apps without `dlig` can pick groups.
- [ ] Conflicts handled: `<-` inside `x<-1` (code reads as "less than minus one", so `ss20` documents the way out), `-->` as an HTML comment end, `<=` read as ≤ and never as ⇐ (a fat left arrow needs `<==`).
- [ ] Prose forms in Sans (`ss10`, off by default): `--` to an en dash and `---` to an em dash.
- [ ] Symbol forms in Sans (`dlig`): `(c)` ©, `(r)` ®, `(tm)` ™, `[ ]` ☐, `[x]` ☑, `1/2` and other fractions through `frac`, and `x` between digits (1920x1080) as ×.
- [ ] Contextual punctuation (`calt`, on): the colon centred between figures (12:30), and the hyphen raised between caps (A-Z).

## 6. Alternates

### 6.1 Stylistic sets (named in the font, so apps show their names)
- [ ] `ss01` Single-storey a.
- [ ] `ss02` Double-storey g (or single-storey, whichever is not the default after Phase 2).
- [ ] `ss03` Disambiguation: a tailed l, a barred I, a slashed 0 and a 1 with a base.
- [ ] `ss04` Open digits: open 4, straight-backed 6 and 9, a flat-topped 3.
- [ ] `ss05` Alternate R, K and M (splayed M, straight-legged R).
- [ ] `ss06` Straight y and j tails.
- [ ] `ss07` Dot shape: square, octagon or diamond.
- [ ] `ss08` Italic exit strokes on n m h i u l.
- [ ] `ss09` The wordmark's letterforms, for setting Geld brand text, if they differ from the defaults.
- [ ] `ss10` Dash ligatures (5.3).
- [ ] `ss11` to `ss16` Code ligature groups (5.3).
- [ ] `ss17` Circled numerals.
- [ ] `ss18` Square forms inside Cut: lets a Cut user pick square corners for single glyphs.
- [ ] `ss19` reserved.
- [ ] `ss20` No arrow ligatures (5.2).

### 6.2 Character variants (`cv01` to `cv40` or so, each with a name)
- [ ] One `cv` per alternate glyph, so a single character can change without a whole set: a, g, G (spur or bar), J, K, M, Q (tail styles), R, W (crossed or plain), t (cut or square foot), f, l, I, y, ß (and the sharp-s capital), 0, 1, 3, 4, 6, 7 (with or without crossbar), 9, $, &, @, %, *, ?, !, ¶, # (slanted or upright), { } (style), and quotes (straight or slanted).
- [ ] `salt` mapping to each glyph's first alternate, for apps that only offer one switch.
- [ ] `aalt` listing every alternate, for the glyph palettes in InDesign and Illustrator.

### 6.3 Swashes
- [ ] Swash caps (`swsh`): A, J, K, M, N, Q, R, Y, and as many more as the language works for in Phase 7.
- [ ] Lowercase swashes: entry forms (`init`) for ascenders d h k l, exit forms (`fina`) for a e n m t, and descender swashes for g j p q y.
- [ ] Contextual swashes (`cswh`): only at the start or end of a word, never beside a colliding letter (2.8).
- [ ] Italic swashes as their own set, since swashes belong most naturally in italic.
- [ ] Titling alternates (`titl`) for caps at display sizes, if Phase 7 shows a need.

## 7. OpenType features

The whole list, with defaults. Every feature is checked by shaping tests (12.2).

| Feature | Purpose | Default |
|---|---|---|
| `ccmp` | Compose and decompose accents, dotless i and j before accents | on |
| `locl` | Language forms (3.1) | on |
| `mark`, `mkmk` | Place accents and stacked accents from anchors | on |
| `kern` | Kerning (section 4) | on |
| `liga` | Text ligatures (5.1) | on |
| `calt` | Arrows, contextual punctuation, code ligature pieces | on |
| `rvrn` | Heavy-weight substitutions in variable fonts (3.4) | on |
| `case` | Case-sensitive forms | off |
| `cpsp` | Capital spacing | off |
| `dlig` | Discretionary and code ligatures | off |
| `smcp`, `c2sc` | Small caps (D14) | off |
| `lnum`, `onum` | Lining (default) and oldstyle figures | lining |
| `pnum`, `tnum` | Proportional (default) and tabular figures | proportional |
| `frac`, `numr`, `dnom` | Fractions | off |
| `sups`, `subs`, `sinf` | Superior, inferior, scientific inferior | off |
| `ordn` | Ordinals | off |
| `zero` | Slashed zero | off (on in Square, D1) |
| `ss01` to `ss20` | Stylistic sets (6.1) | off |
| `cv01` to `cv40` | Character variants (6.2) | off |
| `salt`, `aalt` | Alternates for simple apps and glyph palettes | off |
| `swsh`, `cswh`, `init`, `fina` | Swashes (6.3) | off |
| `titl` | Titling forms | off |
| `ornm` | Ornaments (3.7) | off |

- [ ] Feature names stored in the font for every `ss` and `cv` (`featureNames` and `cvParameters`), so Figma, InDesign and macOS show "Single-storey a" rather than "ss01".
- [ ] Lookup order documented, since `ss20` and the swash rules depend on it.
- [ ] CSS mapping documented: `font-variant-numeric`, `-caps`, `-ligatures`, `-alternates` and `font-feature-settings`.

## 8. Variable fonts and font tables

- [ ] Axes: `wght` 100 to 900, `GRAD` −40 to +40, `CUTS` 0 to 100 in the combined file. Italic ships as its own pair of files (roman and italic), the usual web practice, with `ital` in `STAT`.
- [ ] Files: Geld Sans Cut (roman, italic), Geld Sans Square (roman, italic), and Geld Sans (roman, italic) with the `CUTS` axis.
- [ ] Named instances: Thin to Black for each, 18 per corner style counting italics.
- [ ] `STAT` with axis values, Regular elided, Bold linked to Regular and Italic linked to roman, so font menus group correctly.
- [ ] `avar` for even weight steps, `HVAR` for fast advance widths, `MVAR` for metrics that vary (2.9).
- [ ] Overlaps kept in variable fonts with the `OVERLAP_SIMPLE` flag, and removed in statics.
- [ ] `name` table: family and style (IDs 1, 2, 16, 17), full and PostScript names (4, 6), the variations PostScript prefix (25), version, copyright, trademark, manufacturer, designer, URLs, licence and licence URL (13, 14).
- [ ] `OS/2`: weight and width classes, `fsSelection`, `fsType` 0 (installable), PANOSE, Unicode and code page ranges, vendor ID (a registered "GELD" if available).
- [ ] `head`, `hhea`, `post` and `maxp` consistent across the family, with `fontRevision` matching the version string.
- [ ] Glyph names: readable names in sources, production names (`uniXXXX`) in the shipped fonts.

## 9. Engineering

- [ ] Package `packages/type` (`@geld/type`), TypeScript like the rest of the repository:
  - `src/grid.ts`: units, metrics and the snapping rules.
  - `src/geometry/`: the stroke expansion engine (centreline to outline, chamfer and square joins, inset and offset for weight and grade, shearing for italic), with unit tests.
  - `src/glyphs/`: one skeleton per glyph, or per family of glyphs (n h m u share parts), with anchors for accents.
  - `src/features/`: `.fea` files, hand-written for ligatures and alternates, generated for kerning, marks and `aalt`.
  - `scripts/build.ts`: writes UFO masters and a designspace, then compiles.
- [ ] Compiler: `fontc` (Google's Rust compiler, fast) or `fontmake` (Python), chosen by building a test font with both in Phase 1.
- [ ] Python tools pinned in one requirements file and run through `uv`: fontTools, fontmake or fontc, gftools, fontbakery, ttfautohint, Shaperglot.
- [ ] One command builds everything (`pnpm type:build`), with outputs in `packages/type/dist/`, never committed. Release artifacts come from CI.
- [ ] Builds are reproducible: the same sources give byte-identical fonts.
- [ ] A browser glyph lab (internal page in `apps/site`, not linked or indexed): the grid, the skeleton, the outline at any weight, grade, corner and slant, and any glyph next to its neighbours.
- [ ] UFO export for review in Glyphs or RoboFont (D11). Edits made there are copied back into the source by hand.
- [ ] CI job for `packages/type`: build, tests, fontbakery and shaping tests. The site's Vercel ignore script and the extension release paths do not trigger on it.

## 10. Hinting and rendering

- [ ] Hinting per D18: ttfautohint on static TTFs, variable and web fonts unhinted.
- [ ] Rendering checked at 11 to 16px and at 20px in Chrome, Safari and Firefox on macOS, Chrome and Edge on Windows (DirectWrite, ClearType), and Linux (FreeType).
- [ ] The grid sizes (10, 20, 30 and 40px) checked for sharp edges at 1x and 2x, as was done for the wordmark.
- [ ] Thin weights checked for dropout at small sizes.

## 11. Quality assurance

### 11.1 Automated checks
- [ ] fontbakery with the OpenType, Universal and Google Fonts profiles, no failures, warnings reviewed.
- [ ] Interpolation compatibility (`fontTools varLib.interpolatable`), even though compatibility is built in.
- [ ] Outline checks: contour direction, no stray points, no zero-length segments, no overlaps in statics, extreme points.
- [ ] Coverage against the target glyph sets (3.1), and Shaperglot per language.
- [ ] Kerning collision checks (section 4).
- [ ] Metric consistency across the family.
- [ ] diffenator2 between builds, so every change shows what it changed.

### 11.2 Shaping tests (HarfBuzz)
- [ ] Tests run through `harfbuzzjs` in Vitest: each case is a string, features and the glyphs expected, for example `->` with defaults gives `arrow.left` `arrow.right`, and with `calt` off gives `hyphen` `greater`.
- [ ] Every feature, every ligature group and every `locl` language has cases.
- [ ] Cluster and caret tests: a ligated `->` keeps two clusters.

### 11.3 Visual tests
- [ ] SVG snapshots of every glyph at each anchor weight in each style, compared in CI.
- [ ] Proof pages, generated: character set, waterfall, spacing strings, kerning texts, language samples, feature on and off pairs, UI strings from the digest and the site.
- [ ] PDF proofs for print review.

### 11.4 Apps
- [ ] Browsers: Chrome, Safari, Firefox, Edge.
- [ ] Design apps: Figma, Sketch, Illustrator, InDesign, Affinity.
- [ ] Office apps: Word, Pages, Keynote, Google Docs (only if listed on Google Fonts).
- [ ] Code editors (mainly for Mono): VS Code, Zed, JetBrains, Xcode, and terminals.
- [ ] Font menus show the family grouped correctly on macOS, Windows and in Adobe apps.

## 12. Packaging and distribution

- [ ] Formats: static OTF (CFF) and TTF, variable TTF, WOFF2 for the web.
- [ ] Web subsets by `unicode-range` (latin, latin-ext, vietnamese), plus a full file.
- [ ] CSS: `@font-face` rules for the variable and static fonts, `font-display: swap`, size-adjusted fallback faces so the swap does not move text.
- [ ] npm package (`@geld/fonts`, or `@geld/type` publishing its `dist`), shaped like the Fontsource packages.
- [ ] GitHub Releases with a zip per family, tagged `type-v1.0.0` and so on, separate from the extension's releases.
- [ ] Self-hosted copies on geld.sh for the site's own use.
- [ ] Google Fonts submission once v1 passes its profile, if the licence (D16) allows.
- [ ] Version scheme (`Version 1.000`), a changelog, and a policy that glyph names and feature tags never change after release.

## 13. Documentation and specimen

- [ ] A specimen page on geld.sh: the family, every weight, a live tester (weight, grade, corners, italic, every feature as a switch), the character set, the stylistic sets with their names, the ligature tables, language support and downloads.
- [ ] A usage guide: CSS recipes (dark-mode grade, tabular figures, code ligatures on or off), recommended pixel sizes, and app instructions for turning on stylistic sets.
- [ ] The grid spec published, since the construction is the story.
- [ ] Brand assets regenerated from the font where they are type (the wordmark, D7).

## 14. Legal and naming

- [ ] Licence (D16), with the owner committing it.
- [ ] Reserved Font Name and trademark wording in the `name` table.
- [ ] A check that "Geld Sans" and "Geld Mono" do not clash with existing font names.
- [ ] Copyright line and designer credits.
- [ ] Contributor terms for outside contributions (CLA.md already covers the repository).

## 15. Out of scope for v1

- [ ] Greek and Cyrillic (v1.1).
- [ ] Optical size axis (D15).
- [ ] Width axis, condensed or extended widths.
- [ ] Petite caps, historical forms beyond ſ.
- [ ] Colour fonts and emoji.
- [ ] Non-Latin scripts beyond Greek and Cyrillic.

## 16. Definition of done for Geld Sans v1

- Every character in GF Latin Pro, the figures, punctuation, currency, symbols and arrows above, drawn in Cut and Square, roman and italic, at every weight.
- Every feature in section 7 working and covered by shaping tests.
- Spacing and kerning reviewed in all four styles.
- fontbakery passing, rendering checked on the platforms in section 10.
- Static, variable and web fonts built by CI and released, with the specimen page live.
- The wordmark reproduced by the font (D7).

## 17. Effort, in technical terms

- Encoded characters in v1: about 900 to 1,000.
- Glyphs per style including alternates, small caps, figure sets, swashes and ligature pieces: about 1,600 to 2,000.
- Styles: four (Cut and Square, roman and italic). Square and the weights come from the engine, so the drawing work is about two sets of skeletons (roman and italic), with corrections per weight.
- The largest single risks are the heavy weights (the three-horizontals budget, 2.3) and the italic cuts (2.5). Both are tested in Phase 2 on a handful of glyphs before the full set is drawn.

## 18. Phases

Each phase ends with a review. The next phase starts only once its deliverable is agreed.

1. **Alignment.** Settle section 1. Deliverable: this document with the decisions recorded.
2. **Foundations.** The package, the grid, the geometry engine (Cut and Square, weight, grade, slant), the build into a real font with `H O n o` and space, a first proof page, and CI. Deliverable: a working font file with four glyphs in every style and weight.
3. **Design core.** A to Z, a to z, 0 to 9 and basic punctuation at Regular and SemiBold, in Cut and Square. The wordmark check (D7). Deliverable: a proof of the core in two weights.
4. **Weights.** Thin to Black, contrast and the three-horizontals budget, `avar`. Deliverable: the core in all nine weights.
5. **Italic.** Slanted grid, italic forms and their spacing. Deliverable: the core in italic, all weights.
6. **Character set.** Accents and marks, extended Latin, figure sets, punctuation, currency, math, arrows, shapes, small caps. Deliverable: full GF Latin Pro coverage.
7. **Spacing and kerning.** Deliverable: kerned proofs in every style.
8. **Features.** Ligatures, code ligatures, alternates, swashes, every feature in section 7. Deliverable: all shaping tests passing.
9. **Production.** Tables, hinting, QA, packaging, the specimen page, release. Deliverable: Geld Sans v1 released.
10. **Geld Mono.** Section 19.

## 19. Geld Mono preview (after Sans ships)

Listed now so Sans decisions do not block Mono.

- [ ] Cell width (about 12 units of a 20-unit em, 0.6 em) and how wide letters (m w M W) and narrow ones (i l j) adapt to it.
- [ ] The same corner styles (Cut, Square), weights, grade and italic, all at the same cell width, so bold and italic never change the layout.
- [ ] Code ligatures on by default (5.3), each as contextual pieces in whole cells, with groups to turn off.
- [ ] Box drawing (U+2500 to 257F), block elements (U+2580 to 259F) and Braille patterns (U+2800 to 28FF, generated) filling the cell edge to edge, for terminal UIs and charts.
- [ ] Symbols for Legacy Computing (U+1FB00) as a later step.
- [ ] Powerline symbols, and whether to support patching with Nerd Fonts icons.
- [ ] Zero slashed by default, clear distinctions for I l 1 | and O 0, and a centred `*` and `~`.
- [ ] Line metrics for terminals: no clipping at the line heights editors use.
- [ ] Tested in VS Code, Zed, JetBrains, Xcode, iTerm2, Ghostty, Kitty, WezTerm, Windows Terminal and Alacritty.
