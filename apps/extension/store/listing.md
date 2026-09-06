# Store listing — every field, ready to paste

One place for the text and answers each store asks for, so the four listings say the same thing and match what the code does. Update this file when a permission, host or feature changes; the store forms are copied from here.

Values verified against the store documentation in September 2026. Field names follow each dashboard's labels.

## Shared values

| Field | Value |
| --- | --- |
| Name | `Geld` |
| Publisher / developer name | `Brandon McConnell` |
| Short description (≤132 chars, Chrome takes it from the manifest) | `Hide test files from GitHub diffs. Review what matters; the tests wait in a tidy section at the bottom.` |
| Tagline (Apple subtitle, ≤30) | `Review the code, not the tests` |
| Category | Chrome **Developer Tools** · Edge **Developer tools** · Firefox **Web Development** · App Store **Developer Tools** |
| Language | English (United States) |
| Website / homepage | `https://www.geld.sh` |
| Support URL | `https://github.com/brandonmcconnell/geld/issues` |
| Privacy policy URL | `https://www.geld.sh/privacy` |
| Source code | `https://github.com/brandonmcconnell/geld` (MIT) |
| Price | Free, no in-app purchases |
| Version | Whatever `apps/extension/package.json` says; the stores read it from the manifest. First public release: consider bumping to `1.0.0` before the first submission, because every later version must be higher and the stores show the number. |
| Icon | Chrome/Firefox: `store/assets/chrome-edge/store-icon-128x128.png` · Edge: `store/assets/chrome-edge/store-logo-300x300.png` · Apple: `store/assets/safari/app-icon-1024x1024.png` |
| Trader status (EU DSA question on Chrome, Edge and Apple) | **Non-trader** — an individual distributing a free, open-source extension with no commercial purpose. Only you can declare this. |

### Long description

Chrome allows 16,000 characters, Edge 250–10,000, Firefox has no practical limit, Apple 4,000. This fits all four. Plain text; Chrome and Apple render no markdown, AMO renders a subset.

```
Geld hides test files from GitHub diffs so you can review the code that matters first.

Anywhere GitHub shows a list of changed files — a pull request's "Files changed" tab, commit pages, compare pages — Geld moves the tests out of the way and puts them behind a single "N test files hidden" row at the bottom of the diff, with a "Show test files" toggle that matches GitHub's own controls. Nothing is deleted or rewritten: expand the row and the tests are right there, below the real changes.

WHAT IT DOES
• Hides test files (unit and integration tests, e2e suites, __tests__/ and test/ directories, snapshots, test tooling) and collects them at the bottom of the diff.
• Fixes the header counts: "Files changed", "+400 −120" and "18 files changed" exclude the hidden files, with a hover breakdown showing the totals with and without them.
• Turns the file tree into an accordion: GitHub's tree becomes a "Changes" panel and each hidden category gets its own panel, so the sidebar stays readable on large pull requests.
• Adds "+N −M" line counts (excluding tests) to pull request lists.
• Works on the pull request conversation tab too, so counts are right before you open the diff.
• Optional categories, off by default: generated files and lockfiles, vendored code, AI agent configuration, documentation, CI and tooling config, Storybook stories, fixtures and translations. Each has its own switch.
• Custom gitignore-style patterns and per-repository rules, so Geld can be off for one repo, one org, or on only for an allowlist.
• Toolbar popup with the current repository, the list of hidden files and one-click "turn off for this repo" actions. Alt+Shift+T shows the hidden files for the rest of the visit.
• Light and dark themes, GitHub's classic and new diff views, and GitHub Enterprise Server hosts you add yourself.

PRIVACY
Geld collects nothing: no analytics, no telemetry, no accounts, no server. It runs only on GitHub hosts and reads the page you are already looking at. When a page has no per-file diffs it fetches the pull request's .diff from GitHub, exactly as if you had added ".diff" to the URL. Settings live in your browser's sync storage. Optionally, sign in with GitHub (gist scope only) to sync settings through a secret gist on your own account; the token never leaves your device except to talk to GitHub. Full policy: https://www.geld.sh/privacy

Open source under the MIT licence: https://github.com/brandonmcconnell/geld
```

### Single purpose (Chrome and Edge ask for one sentence)

```
Geld hides test files and other selected review noise from GitHub diff pages and adjusts the page's file and line counts accordingly, so reviewers can read the substantive code changes first.
```

### Permission justifications

Both Chrome's Privacy tab and Edge's Privacy page want one justification per manifest permission. Keep them literal; reviewers compare them against the code.

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings (which categories to hide, custom patterns, repository rules, Enterprise hosts) in sync storage, and caches parsed diffs in local storage so an already-seen pull request is not fetched again. |
| `offscreen` (Chrome/Edge only) | The MV3 service worker cannot call `matchMedia`, so a tiny offscreen document with `reasons: ["MATCH_MEDIA"]` reports whether the user's colour scheme is light or dark; the background swaps the toolbar icon between the black and white marks to match. Nothing else runs there. |
| `scripting` | Registers the content script on GitHub Enterprise Server hostnames the user adds in the options page, after the browser has granted that host. Not used on github.com, where the content script is declared statically. |
| Host `https://github.com/*` | The extension's entire purpose: read the list of changed files on pull request, commit and compare pages, hide matching entries, rewrite the header counts, and fetch a pull request's `.diff` when the page does not include per-file diffs. |
| Host `https://patch-diff.githubusercontent.com/*` | github.com answers `.diff` requests with a redirect to this host, which does not send CORS headers, so the background script needs permission to follow it. |
| Host `https://api.github.com/*` | Only for the optional "Sign in with GitHub" (OAuth device flow) and for reading and writing the user's own secret settings gist. Never contacted unless the user signs in. |
| Optional host `https://*/*` (`optional_host_permissions` / `optional_permissions`) | Never requested as a whole. When the user types a GitHub Enterprise Server hostname in the options page, the extension asks for that single origin so the content script can run there. |
| Content script on `https://github.com/*` at `document_start` | Runs early so the header counts can be rewritten before first paint instead of flashing GitHub's numbers first. |
| `commands` (Alt+Shift+T) | Shows or hides the hidden files on the current tab without changing settings. |

### Remote code

**No.** All JavaScript ships inside the package; nothing is fetched and executed at runtime. (Chrome's Privacy tab and Edge's Privacy page both ask.)

### Data usage disclosure (Chrome's Privacy tab; Edge's Privacy page has the same list)

Chrome defines "collect" as data the extension transmits off the device. Geld sends nothing to its developer, but with sign-in on it does send the user's OAuth token to `api.github.com` and stores their settings in the user's gist. The defensible, review-safe answer:

- Tick **Authentication information** and, in the notes, say: "Only when the user opts into GitHub sign-in: a GitHub OAuth token (scope: gist) is stored locally and sent solely to api.github.com to read and write the user's own settings gist. Nothing is sent to the developer or to any other party."
- Leave every other category unticked (personally identifiable information, health, financial, personal communications, location, web history, user activity, website content). Geld reads page content but never transmits it.
- Certify all three statements (no sale/transfer to third parties outside approved use cases; no use unrelated to the single purpose; no use for creditworthiness or lending).

If you would rather list nothing, the honest alternative is to publish without the sign-in feature. A disclosure that does not match the code is the most common reason for a Chrome rejection.

Firefox reads this from the manifest instead: `browser_specific_settings.gecko.data_collection_permissions` is `{ required: ['none'] }` (`wxt.config.ts`), required for all add-ons first submitted after 3 Nov 2025. If an AMO reviewer considers the opt-in gist sync to be data collection, the matching change is `{ required: ['none'], optional: ['authenticationInfo'] }`, which Firefox shows as a permission the user can grant.

### Notes for the reviewer (Chrome "Test instructions", Edge "Notes for certification", AMO "Notes to reviewer", Apple "Notes")

```
Geld needs no account and has no hidden features. To test: install, then open
https://github.com/wxt-dev/wxt/pull/2544/files (classic diff view, 6 test files)
or https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef
(new React diff view). The test files move behind a "6 test files hidden" row at
the bottom; the header counts exclude them; the file tree gains a "Tests" panel.
The toolbar popup lists the hidden files. Alt+Shift+T shows/hides them.

"Sign in with GitHub" (popup or options) is optional and uses GitHub's OAuth
device flow with the `gist` scope only, to keep settings in a secret gist on the
tester's own account. No server of ours is involved; no data is sent anywhere
except GitHub.

Source: https://github.com/brandonmcconnell/geld (MIT). The package is built
with WXT from TypeScript; see the sources zip / repository README for the exact
build commands (Node 22, pnpm 10: `pnpm install --frozen-lockfile`, then
`pnpm zip:chrome` / `pnpm zip:firefox` / `pnpm zip:edge`).
```

## Chrome Web Store

Dashboard: <https://chrome.google.com/webstore/devconsole>. One-time US$5 registration; verify the contact email; enable 2-step verification on the Google account. The **publisher display name** cannot be changed later without support.

| Tab | Field | Value |
| --- | --- | --- |
| Package | Upload | `geld-<version>-chrome.zip` from `pnpm zip:chrome` or the GitHub Release |
| Store listing | Title / summary | From the manifest (`Geld`, description above); not editable here |
| Store listing | Detailed description | Long description above |
| Store listing | Category | Developer Tools |
| Store listing | Language | English (United States) |
| Store listing | Store icon | `store/assets/chrome-edge/store-icon-128x128.png` |
| Store listing | Screenshots | First five JPEGs in `store/assets/chrome-edge/screenshots/` (1–5, **1280×800**) |
| Store listing | Small promo tile | `store/assets/chrome-edge/promo-small-440x280.png` |
| Store listing | Marquee promo tile | `store/assets/chrome-edge/promo-marquee-1400x560.png` (optional; needed to be eligible for featuring) |
| Store listing | Promo video | Optional YouTube URL |
| Store listing | Official URL | `https://www.geld.sh` (must be a site you have verified in Google Search Console, otherwise use the Homepage field) |
| Store listing | Homepage URL | `https://www.geld.sh` |
| Store listing | Support URL | `https://github.com/brandonmcconnell/geld/issues` |
| Store listing | Mature content | No |
| Privacy | Single purpose | Above |
| Privacy | Permission justifications | Above, one box per permission (`storage`, `offscreen`, `scripting`, host permissions, remote code) |
| Privacy | Remote code | No |
| Privacy | Data usage | Above |
| Privacy | Privacy policy URL | `https://www.geld.sh/privacy` |
| Distribution | Visibility | Public |
| Distribution | Regions | All regions |
| Distribution | Payment | Free |
| Test instructions | | Reviewer notes above |
| Account | Trader / non-trader | Non-trader |

Review: hours to a few days for an established account, up to ~2–3 weeks for a brand-new account; anything touching `host_permissions` gets a closer look. Updates uploaded through the API are reviewed the same way and publish automatically on approval. You get the **extension ID** (32 letters) from the item URL after the first upload, and the **publisher ID** from Publisher > Settings — both go into the CI secrets.

## Microsoft Edge Add-ons

Dashboard: <https://partner.microsoft.com/dashboard/microsoftedge>. Registration is free (Microsoft account; individual or company). Edge accepts the Chrome package unchanged, but WXT already produces `geld-<version>-edge.zip`, so use that.

| Page | Field | Value |
| --- | --- | --- |
| Packages | Upload | `geld-<version>-edge.zip` |
| Availability | Visibility | Public |
| Availability | Markets | All |
| Properties | Category | Developer tools |
| Properties | Website URL | `https://www.geld.sh` |
| Properties | Support contact | `https://github.com/brandonmcconnell/geld/issues` |
| Properties | Privacy policy requirements | **Yes** it accesses personal information (it reads GitHub pages and, optionally, an OAuth token) → Privacy policy URL `https://www.geld.sh/privacy` |
| Privacy (new page, rolling out through May 2026) | Single purpose, permission justifications, remote code (No), data usage, privacy policy URL | Same answers as Chrome |
| Store listings (per language) | Display name | Geld (from the manifest) |
| Store listings | Description | Long description (250–10,000 chars) |
| Store listings | Extension logo | `store/assets/chrome-edge/store-logo-300x300.png` |
| Store listings | Small promotional tile | `store/assets/chrome-edge/promo-small-440x280.png` (optional) |
| Store listings | Large promotional tile | `store/assets/chrome-edge/promo-marquee-1400x560.png` (optional) |
| Store listings | Screenshots | All six JPEGs in `store/assets/chrome-edge/screenshots/` |
| Store listings | YouTube video URL | Optional |
| Store listings | Short description | Manifest description (edit the manifest to change it) |
| Store listings | Search terms | ≤7 terms, ≤21 words, ≤30 chars each: `github`, `pull request`, `code review`, `diff`, `hide test files`, `developer tools`, `git` |
| Properties | Mature content | No |
| Submit | Notes for certification | Reviewer notes above |
| Account | Trader status | Non-trader |

Certification: up to 7 business days, usually 1–3. Updates through the Publish API are certified the same way and publish automatically. After the first submission the product page URL contains the **Product ID** (a GUID) for the CI secrets; the Publish API **Client ID** and **API key** come from Partner Center > Publish API (the key expires every 72 days).

## Firefox Add-ons (AMO)

Dashboard: <https://addons.mozilla.org/developers/>. Free; a Mozilla account with 2FA. Choose **On this site** (listed). AMO asks for the source archive because the package is bundled: upload `geld-<version>-sources.zip`, which spans the whole monorepo after this branch (`wxt.config.ts` `zip.sourcesRoot`).

| Step | Field | Value |
| --- | --- | --- |
| Upload | Add-on file | `geld-<version>-firefox.zip` |
| Upload | Compatible with | Firefox (desktop). Leave Firefox for Android unticked; GitHub's mobile pages are not supported. |
| Upload | Source code | Yes → `geld-<version>-sources.zip` |
| Describe | Name | Geld |
| Describe | Add-on URL (slug) | `geld` → `https://addons.mozilla.org/firefox/addon/geld/` |
| Describe | Summary (≤250) | Manifest description |
| Describe | Description | Long description |
| Describe | Experimental | No |
| Describe | Categories (≤2) | Web Development; Other |
| Describe | Support email | your address |
| Describe | Support website | `https://github.com/brandonmcconnell/geld/issues` |
| Describe | Homepage | `https://www.geld.sh` |
| Describe | License | MIT/X11 License |
| Describe | Privacy policy | Tick; paste the "PRIVACY" paragraph from the long description plus the URL |
| Describe | Notes to reviewer | Reviewer notes above, plus the exact build: `Node 22, pnpm 10.33.3 (corepack). From the archive root: pnpm install --frozen-lockfile && pnpm zip:firefox → apps/extension/.output/geld-<version>-firefox.zip` |
| Media | Icon | `store/assets/chrome-edge/store-icon-128x128.png` (AMO also derives 64 and 32) |
| Media | Screenshots | all six JPEGs in `store/assets/chrome-edge/screenshots/` |
| Manifest | `gecko.id` | `geld@brandonmcconnell.com` — this is the **extension ID** for the API (already in `wxt.config.ts`) |
| Manifest | `data_collection_permissions` | `{ required: ['none'] }` (present) |

Review: listed add-ons are validated and signed automatically, usually within minutes, and are published then; a human review follows later. Updates via the API follow the same path, which makes Firefox the fastest store to update. Your API **JWT issuer** and **secret** come from <https://addons.mozilla.org/developers/addon/api/key/>.

## Safari (Mac App Store)

Safari extensions ship inside a macOS app. Cost: Apple Developer Program, US$99/year. Tools: Xcode 26 on macOS 26 (the CI action requires it), `xcrun safari-web-extension-converter`. Apple's review reads the app, so the wrapper app must at least open, explain how to enable the extension in Safari > Settings > Extensions, and quit — the converter's template does exactly that.

One-time setup:

1. Certificates, Identifiers & Profiles: register two App IDs, `sh.geld.Geld` and `sh.geld.Geld.Extension` (or your choice; `APPLE_BUNDLE_ID` in the workflow is the app's). Create "Mac App Store Connect" provisioning profiles for both, and export "3rd Party Mac Developer Application" + "3rd Party Mac Developer Installer" certificates as one `.p12`.
2. App Store Connect > Apps > **+**: platform macOS, name `Geld`, primary language English (U.S.), bundle ID `sh.geld.Geld`, SKU `geld-safari`.
3. Users and Access > Integrations > App Store Connect API: create a team key with the **App Manager** role; download the `.p8` once.

| Section | Field | Value |
| --- | --- | --- |
| App Information | Name (≤30) | Geld |
| App Information | Subtitle (≤30) | Review the code, not the tests |
| App Information | Primary category | Developer Tools |
| App Information | Secondary category | Productivity (optional) |
| App Information | Content rights | Does not contain third-party content |
| App Information | Age rating | Answer "None" to everything → 4+ |
| App Information | Privacy policy URL | `https://www.geld.sh/privacy` |
| Pricing | Price | Free, all territories |
| App Privacy | Data collection | **Data Not Collected** is the natural answer for a no-server extension. If you declared "Authentication information" on Chrome, mirror it here under "Contact info / Other data → not linked to you, used for app functionality". Be consistent across stores. |
| Version | Screenshots (Mac) | all six 2880×1800 JPEGs in `store/assets/safari/screenshots/` |
| Version | Promotional text (≤170) | `Hide test files from GitHub diffs. Review what matters; the tests wait in a tidy section at the bottom.` |
| Version | Description (≤4000) | Long description |
| Version | Keywords (≤100 chars) | `github,pull request,code review,diff,tests,developer,safari extension,git` |
| Version | Support URL | `https://github.com/brandonmcconnell/geld/issues` |
| Version | Marketing URL | `https://www.geld.sh` |
| Version | Version | Must equal the manifest version (the workflow writes it into the Xcode project) |
| Version | Copyright | `© 2026 Brandon McConnell` |
| Version | Build | The build uploaded by CI (or Xcode > Product > Archive > Distribute) |
| App Review Information | Sign-in required | No |
| App Review Information | Contact | Your first name, last name, phone, email |
| App Review Information | Notes | Reviewer notes above, plus: "This is a Safari web extension. After installing, enable it in Safari > Settings > Extensions, then open the GitHub URLs above." |
| Version release | | Automatically release after approval |
| Xcode project | App icon | `store/assets/safari/app-icon-1024x1024.png`; copy it into the generated project's 512pt@2x `AppIcon` slot |
| Xcode project | App Sandbox | On (required for the Mac App Store; the converter enables it) |
| Xcode project | Category | `public.app-category.developer-tools` |

Review: typically 24–48 hours. Every update is a new App Store version with a new build; screenshots and text can be changed without a new build.

## Things the stores show that come from the manifest

Changing these means a new version, not a dashboard edit:

- `name`, `short_name`, `description` (Chrome/Edge/AMO summary), `version`, `icons`, `homepage_url` (`https://github.com/brandonmcconnell/geld`; AMO shows it as the add-on homepage unless overridden in the listing).
- The permission list users see at install: `storage`, `offscreen`, `scripting`, and "Read and change your data on github.com, patch-diff.githubusercontent.com and api.github.com".
