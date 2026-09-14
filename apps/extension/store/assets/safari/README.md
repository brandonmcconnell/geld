# Mac App Store screenshots

Apple requires screenshots to show Geld actually running, not title art. Capture these on the same physical Mac used for App Review testing, at one of Apple’s accepted 16:10 sizes (2880×1800 preferred), and place the JPEGs in `screenshots/`:

1. `01-containing-app.jpg` — Geld’s containing app showing the extension’s enabled status and setup steps.
2. `02-safari-settings.jpg` — Safari Settings → Extensions with Geld enabled.
3. `03-hidden-files.jpg` — a public GitHub pull request with Geld’s hidden-files row and corrected counts visible.
4. `04-count-breakdown.jpg` — the line-count breakdown open in Safari.
5. `05-toolbar-popup.jpg` — Geld’s toolbar popup on the pull request.
6. `06-settings.jpg` — Geld’s settings page showing categories and custom patterns.

Use `https://github.com/wxt-dev/wxt/pull/2544/files` for the public demonstration. Do not include private repository names, account menus, tokens, email addresses, or unrelated browser tabs.

After committing the captures, run **Actions → Store listings → Run workflow → `safari`**. The workflow uploads them to the current Mac App Store version. If this folder has no JPEGs, it deliberately skips Safari rather than replacing real screenshots with marketing artwork.
