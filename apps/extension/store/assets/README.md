# Store asset pack

Finished, exact-size exports for the marketplace forms. The real Geld SVGs are composited over generated editorial source art; all product screens are captures of the built extension running on public GitHub pages, not generated UI.

## Upload map

| Store field | File(s) |
| --- | --- |
| Chrome store icon | `chrome-edge/store-icon-128x128.png` |
| Chrome small promo tile | `chrome-edge/promo-small-440x280.png` |
| Chrome marquee promo tile | `chrome-edge/promo-marquee-1400x560.png` |
| Chrome screenshots (maximum 5) | the first five files in `chrome-edge/screenshots/` |
| Edge extension logo | `chrome-edge/store-logo-300x300.png` |
| Edge promo tiles | the two `chrome-edge/promo-*.png` files |
| Edge screenshots (maximum 6) | all six files in `chrome-edge/screenshots/` |
| Firefox icon | `chrome-edge/store-icon-128x128.png` |
| Firefox screenshots | all six files in `chrome-edge/screenshots/` |
| Mac App Store icon | `safari/app-icon-1024x1024.png` |
| Mac App Store screenshots | all six files in `safari/screenshots/` |
| Optional social / repository preview | `social/geld-social-1200x630.png` |

Chrome/Edge/Firefox screenshots are 1280×800 JPEG. Their Mac App Store equivalents are 2880×1800 JPEG. Promo exports are opaque PNG; the macOS icon is RGBA with transparent space around Apple's rounded app tile.

## Provenance

- `raw/ai-*-source.png`: generated abstract diff fields. They contain no product text or generated logos; the exact words and logo SVGs were added in the final render.
- `raw/02-counts-tooltip.png`, `03-file-tree.png`, `06-pr-list.png`: Chrome captures from the built Geld 0.1.1 extension on public GitHub pages.
- `raw/04-popup.png`: the real browser-action popup reading the active GitHub tab.
- `raw/05-options.png`: the built extension's options page.
- `raw/01-hidden-row-scene.png` and `04-popup-scene.png`: compositions made only from the real captures above. The first combines the live pull-request viewport with the real hidden-files row captured from the same page; the second places the real popup over its real active tab.

The public pages captured on 6 September 2026 were:

- `https://github.com/vitest-dev/vitest/pull/10554/files` (39 hidden test files)
- `https://github.com/wxt-dev/wxt/pulls` (line counts on pull-request rows)

Re-capture the product screens before a listing refresh if GitHub's UI or Geld's UI changes. The prompts and capture recipe remain in `../image-prompts.md`.
