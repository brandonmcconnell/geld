# Store artwork — specs and image-generation prompts

Everything the four listings need, with a prompt per image written for an image model. The prompts are deliberately long; trim only if the model's limit forces it. Read the style block first: every prompt assumes it.

## Style block (paste before every prompt)

```
STYLE, applies to the whole image:
Brand: "Geld", a browser extension that hides test files from GitHub pull request diffs. Voice: calm, precise, developer-native. Tagline: "Review the code, not the tests".
Geometry: everything is square-cornered. No rounded rectangles, no pills, no drop shadows, no glassmorphism, no 3D, no gradients on surfaces. The only ornament is the brand's "cut corner": a 45° bevel that clips ONLY the top-left and bottom-right corners of a button or card (like a chamfered ticket). Use it sparingly, on at most one or two elements.
Palette (light): background #ffffff, ink #16181d, secondary surface #f4f5f7, hairline borders #dcdee2, muted text #5e646c, addition green #007f35 with pale fill #dff3e6, deletion red #d01d21 with pale fill #fbe4e3.
Palette (dark): background #0b0d12, card #111418, ink #f0f2f5, hairline rgba(255,255,255,0.12), muted text #a1a7b0, addition green #4bcb71, deletion red #ff6367.
Typography: Geist Sans for UI and headlines (geometric grotesque, tight tracking, medium weight for headlines, regular for body); Geist Mono for code, file paths and numbers like +400 −120. Headlines are sentence case, never all caps, never italic. Keep on-image text to a minimum and render it crisp and straight; if you cannot render text exactly as written, leave a clean empty area where it goes.
Logomark: a strict geometric "G" made of two nested square outlines, both with the top-left and bottom-right corners cut at 45°, the G's mouth opening to the right. Solid #16181d on light backgrounds, solid #ffffff on dark. Do NOT invent a different mark — reserve the space and the real SVG will be composited in.
Mood: editorial, quiet, high contrast, lots of whitespace, one focal object. Think a well-set technical magazine spread, not a SaaS landing page. No people, no hands, no stock-photo laptops, no abstract "tech" particles, no glowing lines, no neon, no purple gradients.
Any GitHub UI shown may keep GitHub's own rounded corners and colours (that is real product UI); everything Geld adds around it is square.
```

Two production notes that apply to all assets:

- **Real screenshots, real product.** Store policies want screenshots that show the actual experience. Capture the real UI (recipe at the end) and let the image model produce the frame, background and captions around it. Where a prompt says `[SCREENSHOT n]`, attach that capture as a reference image and tell the model to place it unaltered; if the model cannot take references, generate the background with an empty rectangle at the given position and composite the capture yourself. Never let a model redraw a GitHub page — it will hallucinate file names and counts.
- **Flat files.** Promo tiles and Chrome/Edge screenshots must be opaque (no alpha channel); export PNG-24 or JPEG at the exact pixel sizes. Only the macOS app icon keeps transparency.

## Asset list

| # | Asset | Size | Used by | Prompt |
| --- | --- | --- | --- | --- |
| 1 | Small promo tile | 440×280 | Chrome (required), Edge (optional) | P1 |
| 2 | Marquee / large promo tile | 1400×560 | Chrome (featuring), Edge (optional) | P2 |
| 3 | Store logo | 300×300 | Edge (required) | no prompt — export the SVG |
| 4 | macOS app icon | 1024×1024 | Mac App Store (required) | P3 |
| 5 | Screenshot set, 5 (6 for Edge) | design at 2880×1800, export also at 1280×800 | all four stores | P4–P9 |
| 6 | Optional social/OG card | 1200×630 | geld.sh, GitHub social preview | P10 |

The screenshot set is designed once at 2880×1800 (Apple's sharpest size, 16:10) and downscaled to 1280×800 for Chrome, Edge and Firefox. Keep all text ≥ 40 px tall at 2880 so it is still legible at 1280 (and at the 640×400 thumbnail Chrome actually renders).

## P1 — Small promo tile, 440×280

```
[STYLE BLOCK]

A 440×280 pixel promotional tile, landscape, flat white background #ffffff, no border.

Composition: split into two columns. The left 40% is empty white space reserved for the logomark: a 120×140 px area centred vertically, 40 px from the left edge — leave it blank. The right 60% holds a single miniature "diff" illustration, not a real screenshot: five horizontal rows, each a thin hairline-bordered rectangle 200 px wide and 26 px tall in #f4f5f7, stacked with 10 px gaps, representing changed files in a pull request. Each row has a short placeholder bar instead of a file name (a grey, square-ended bar #dcdee2, 6 px tall, varying widths between 60 and 120 px). The bottom two rows are visually "collapsing": they are drawn at 60% opacity and pushed 14 px lower, and beneath them a single square-cornered row in ink #16181d with white mono text reads exactly: 2 test files hidden

To the right of the top three rows, tiny mono numerals in green #007f35 and red #d01d21: +42 −7, +118 −30, +9 −1.

No headline, no tagline on this asset (it renders at thumbnail size in search results). Sharp edges, pixel-aligned, generous margins (minimum 24 px from every edge). Output must be fully opaque.
```

## P2 — Marquee / large promo tile, 1400×560

```
[STYLE BLOCK]

A 1400×560 pixel marquee banner, landscape, dark theme: background #0b0d12, no vignette, no texture.

Layout on a 12-column grid with 64 px outer margins.
Left, columns 1–5: headline in Geist Sans Medium, white #f0f2f5, 72 px, two lines, left-aligned, sentence case:
Review the code,
not the tests.
Below it, 28 px of space, then a one-line subhead in Geist Sans Regular, 26 px, muted #a1a7b0: Hides test files from GitHub diffs. Chrome, Edge, Firefox, Safari.
Below that, 40 px of space, then one button: square-cornered with the brand's cut corners (top-left and bottom-right bevelled 12 px), white fill #f0f2f5, ink text #16181d in Geist Sans Medium 22 px: Add to browser. The button is the only bevelled element in the image.
Reserve a 96×112 px blank area for the logomark in the top-left corner, 64 px from top and left, above the headline — leave it empty.

Right, columns 7–12: a stylised, slightly oversized (about 1.15× scale) fragment of a GitHub "Files changed" header, dark GitHub theme, cropped so it bleeds off the right and bottom edges. It shows: a row of tab labels where "Files changed" is active with a count pill reading 12; to the right, line totals in Geist Mono: "+400 −120" in green #4bcb71 and red #ff6367, immediately followed by a small grey label "6 tests" in #a1a7b0. Beneath the header, three file rows (hairline-separated cards, GitHub's usual 6 px rounded corners are fine here) with mono placeholders for file names — no readable file names. At the very bottom of the visible fragment, a full-width row in a slightly lighter surface #111418 with a small chevron on the left and mono text: 6 test files hidden — Show test files. This row is the hero detail: give it the most contrast and let the cropping make it obvious that the tests were tucked below the real changes.

Nothing else. No glow, no gradient, no floating shapes. Text must be exactly as written; if any text cannot be rendered exactly, leave the space blank instead of approximating. Fully opaque.
```

## P3 — macOS app icon, 1024×1024 (Mac App Store)

macOS icons are a rounded square drawn inside a 1024 canvas with transparent margins (the shape occupies roughly 824×824 centred), which is the one place rounded corners are expected. Apple applies no mask on macOS, so the shape and its subtle shadow must be in the file.

```
[STYLE BLOCK — except: this asset is a macOS app icon and follows Apple's icon geometry, so the outer shape IS a rounded square.]

A 1024×1024 pixel macOS Big Sur–style application icon on a fully transparent background.
Shape: a single rounded square 824×824 px centred on the canvas (100 px transparent margin on every side), corner radius 185 px, matte, no glossy highlight, no bevel edge, no inner border. Beneath it the standard soft macOS shadow: black at 30% opacity, blur 40 px, offset 0 down 12 px, nothing else outside the shape.
Fill: solid white #ffffff. No gradient, no texture, no noise.
Mark: the Geld logomark in solid ink #16181d, centred optically, sized so its height is 62% of the square (about 510 px tall) and its width follows the mark's natural proportions (about 0.855 × height). Reserve this area blank; the real SVG will be composited exactly here.
Nothing else: no text, no ring, no badge, no Safari compass, no browser chrome. The result should read as a crisp black "G"-shaped mark on a white tile, unmistakable at 16 px.
Also render a dark variant for review only (not shipped): same shape, fill #0b0d12, mark #ffffff.
```

Edge's 300×300 logo and every other icon are plain exports of `assets/brand/geld-logomark.svg` (black mark on a white square, mark height 60% of the tile, no margin tricks). No prompt needed.

## Screenshots — captions and frames

All six share one frame so the set reads as a series. Design at 2880×1800.

Frame spec (put this into every screenshot prompt after the style block):

```
FRAME: 2880×1800 canvas, light theme, background #ffffff. A caption band occupies the top 380 px: 120 px from the left edge, a headline in Geist Sans Medium 96 px, ink #16181d, one line; 24 px beneath it a subline in Geist Sans Regular 44 px, muted #5e646c, one line. Below the band, the reference screenshot sits in a rectangle from x=120 to x=2760 (2640 px wide), starting at y=420 and running off the bottom edge of the canvas (it is intentionally cropped by the canvas bottom), with a 2 px hairline border #dcdee2 on the visible top, left and right edges and no shadow. The screenshot is placed unaltered, crisp, no perspective, no tilt, no browser window chrome added around it. Nothing else on the canvas.
```

### P4 — Screenshot 1: the hidden row

```
[STYLE BLOCK] [FRAME]
Headline: Tests wait at the bottom.
Subline: A pull request with 6 test files. They are one row, expanded on demand, never deleted.
Reference [SCREENSHOT 1]: the Files changed tab of a real pull request with Geld on, scrolled so the last real file and the "6 test files hidden · Show test files" row are both visible, light GitHub theme.
```

### P5 — Screenshot 2: honest counts

```
[STYLE BLOCK] [FRAME]
Headline: Counts that exclude the noise.
Subline: +400 −120 without the tests, with the full breakdown one hover away.
Reference [SCREENSHOT 2]: the top of a pull request's Files changed tab where the header shows the adjusted totals followed by the grey "6 tests" label, with Geld's hover breakdown tooltip open (three rows: excluding tests, including tests, tests only). Crop the capture to the header and the first file so the numbers are large.
```

### P6 — Screenshot 3: file tree accordion

```
[STYLE BLOCK] [FRAME]
Headline: A file tree that stays readable.
Subline: Changes in one panel, hidden categories in their own. One open at a time.
Reference [SCREENSHOT 3]: the diff with the file-tree sidebar visible, the "Changes" panel collapsed and the "Tests" panel open, showing the tree of test files with folder rows.
```

### P7 — Screenshot 4: popup

```
[STYLE BLOCK] [FRAME]
Headline: One click per repo or org.
Subline: The popup shows what is hidden on this tab and turns Geld off where you do not want it.
Reference [SCREENSHOT 4]: the toolbar popup open over a pull request page: repository name, the count and list of hidden paths, the on/off switch and the "Turn off for this repository / organisation" actions. Capture at 2× so the popup is sharp; the page behind may be blurred by the browser but should stay a recognisable GitHub page.
```

### P8 — Screenshot 5: options and patterns

```
[STYLE BLOCK] [FRAME]
Headline: Your patterns, gitignore syntax.
Subline: Seven categories with their own switches, custom patterns per repository, and a path tester that explains every decision.
Reference [SCREENSHOT 5]: the options page, "What to hide" card with the category switches, and the custom patterns editor with the path tester result visible.
```

### P9 — Screenshot 6 (Edge allows six): pull request lists

```
[STYLE BLOCK] [FRAME]
Headline: Line counts in every list.
Subline: +N −M without tests on /pulls and search results, fetched quietly in the background.
Reference [SCREENSHOT 6]: a repository's Pull requests list with Geld's "+N −M" chips visible on several rows.
```

## P10 — Social / OG card, 1200×630 (optional, geld.sh and GitHub social preview)

```
[STYLE BLOCK]

A 1200×630 pixel social card, light theme, background #ffffff, 80 px margins.
Top-left: reserve a blank 84×98 px area for the logomark.
Centre-left, vertically centred: headline in Geist Sans Medium 88 px, ink #16181d, two lines: Review the code, / not the tests.
Bottom-left, 80 px from the bottom: a single line in Geist Mono 26 px, muted #5e646c: geld.sh · Chrome · Edge · Firefox · Safari
Right third: the same miniature diff illustration as the small promo tile (five hairline file rows, the bottom two fading and collapsing beneath a single ink row reading "2 test files hidden"), scaled to about 420 px wide, vertically centred, bleeding 40 px off the right edge. Fully opaque, no shadows, no gradients.
```

## Capturing the reference screenshots

The captures are the product; take them from the real pages the project already uses for verification (no sign-in needed), at 2× device pixel ratio so they are sharp at 2880 wide.

- Viewport 1440×900 at `deviceScaleFactor: 2` gives 2880×1800 raw pixels, the exact Apple size; the frame in the prompts then crops the bottom.
- Pages: `https://github.com/wxt-dev/wxt/pull/2544/files` (classic view, 6 test files: screenshots 1, 2, 3), `https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef` (React view alternative), `https://github.com/wxt-dev/wxt/pulls` (screenshot 6). Popup and options (4, 5) are captured from `chrome-extension://<id>/popup.html` and `options.html` — open them in a tab at 2× or use the real popup on a Retina display.
- Build with `pnpm zip:chrome`, install the unzipped folder in Chrome with Puppeteer's `browser.installExtension()` and `--enable-unsafe-extension-debugging` (branded Chrome ignores `--load-extension`), bring the tab to the front before interacting, wait for the hidden row to appear, then `page.screenshot({ type: 'png' })`.
- Prefer GitHub's light theme for the set (the stores' pages are white); a dark-theme variant of screenshot 1 makes a good marquee reference.
- Check every capture for anything you do not want public: other people's avatars are fine (public PR), but close your own account menu.

## Export checklist

- 440×280 and 1400×560: PNG-24, no alpha, exact size.
- 300×300 Edge logo: PNG from the SVG, white background.
- 1024×1024 macOS icon: PNG **with** alpha; drop it into `AppIcon.appiconset` as the 512pt@2x slot.
- Screenshots: 2880×1800 PNG for Apple; the same files downscaled to 1280×800 (Lanczos) as PNG-24 without alpha for Chrome, Edge and Firefox. Chrome shows them at 640×400 — check legibility at that size.
- Keep the source files (Figma/Sketch/PSD) in a private place, not in this repository; commit only the exported PNGs if you want them versioned (`apps/extension/store/assets/` is a reasonable home).
