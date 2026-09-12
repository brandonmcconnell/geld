# Publishing Geld

Two things reach users, through two separate, fully automated paths. Nothing is done by hand in a store dashboard or a terminal once the one-time setup below exists.

## Day to day

**Fixing PR-list selectors after a GitHub markup change** works the same way, without a store release: the catalog also carries the *list surfaces* and *diffstat surfaces* (`packages/core/src/list-surfaces.ts`, `BUNDLED_LIST_SURFACES` / `BUNDLED_DIFFSTAT_SURFACES`) — per GitHub UI, how rows or hovercards are recognised, where the `+N −M` goes, where the author or subject is written, and any CSS. Edit the spec, push to `main`; CI publishes the catalog and installed extensions adopt it within about six hours (or on "Check now"). New *behaviour* (a new placement mode, a new kind of author source) still needs code and a release.

**Changing which files Geld hides** (the pattern catalog: `packages/core/src/categories.ts`, `test-patterns.ts`): edit, push to `main`. CI regenerates `catalog/patterns.json`, bumps `CATALOG_VERSION` if you did not, signs the file, verifies the signature and commits `catalog/patterns.{json,sig}` back to `main` as `catalog: publish patterns <version> [skip ci]`. Installed extensions fetch the catalog from this repository every six hours (or on "Check now" in the options page), verify the signature against the public key compiled into them, and switch over. No store release is involved.

**Shipping a new extension version**: any push to `main` that touches the extension makes CI cut a GitHub Release whose zips carry a four-part version — the version in `apps/extension/package.json` plus the CI run number, e.g. `0.1.1.92`. Stores only need the version to increase, so nothing is bumped by hand; change `package.json` only when the marketing version should change (`0.1.1` → `0.2.0`). The publish workflow (`.github/workflows/publish.yml`) then runs **twice a day** (05:17 and 17:17 UTC) with the latest release — the normal path, so a change on `main` reaches every store within about twelve hours — and **immediately after a CI run whose commit message contains `[publish]`** for anything urgent (an agent can do this by putting `[publish]` in the commit message). It can also be run on demand (Actions → "Publish to stores" → Run workflow, where a release tag and channels can be chosen). Two scheduled runs a day is deliberate: Firefox allows 24 version submissions and 48 file uploads a day per account, and the other stores accept one submission per review cycle, so the schedule leaves room for urgent pushes without hitting either limit. For each store it does one of three things:

- **submits** the latest release when the store has an older version and nothing under review;
- **skips** when the store already has this version (repeated runs are idempotent). Firefox and Safari check this with a read-only API call *before* uploading anything, so a re-run costs no AMO quota and no macOS runner time;
- **skips with a warning** when a submission is under review, or when Firefox's daily quota is used up (the warning says roughly when it frees up). Chrome and Edge have no API to cancel a review, so the newest release is picked up by the next scheduled run once the review clears. Apple can withdraw a submission that is still *waiting* for review, and the Safari job does, so there the newest build replaces the pending one.

Nothing fails silently: a skipped store is a warning annotation on the run, and the next scheduled run retries it with the newest release. The only recurring task is glancing at the "Publish to stores" run summary now and then: it names any store that skipped or failed, and a bad credential shows up there.

| Store | What the job does | Review |
|---|---|---|
| Chrome Web Store | uploads the zip, publishes to the default (public) target | hours–days |
| Edge Add-ons | uploads to the draft, submits it with the notes | 1–7 days |
| Firefox AMO | `web-ext sign --channel listed` with the sources zip | usually minutes (auto-approval) |
| Safari | macOS runner: `safari:sync` (build number = CI run number), `xcodebuild archive` + export with cloud signing, then `fastlane deliver` uploads the `.pkg`, attaches it to the version, sets the release notes and **submits for review** (withdrawing a submission still *waiting* for review; one already *in* review cannot be replaced and is reported as skipped) | 1–2 days |

## One-time setup

All secrets go under **Settings → Secrets and variables → Actions → New repository secret**. Secret values are pasted exactly as generated, with no quotes, prefixes or surrounding text.

### Catalog signing key — `GELD_CATALOG_PRIVATE_KEY`

The catalog is signed with an Ed25519 key. The **public** half lives in `packages/core/src/catalog-key.ts` and ships inside the extension, which refuses any catalog that does not verify against it; the **private** half is used only by CI to sign.

1. `pnpm catalog:keygen` prints a public key and a private key (both base64, one line each).
2. Put the public key in `packages/core/src/catalog-key.ts` (`CATALOG_PUBLIC_KEY`) and commit it.
3. Put the private key in the secret `GELD_CATALOG_PRIVATE_KEY`. Keep a copy in a password manager as backup.

Rotating the key is the same three steps; CI re-signs the catalog on the next push. If the secret is missing when a pattern changes, CI fails with a message saying so (`pnpm catalog:sign` with `GELD_CATALOG_PRIVATE_KEY` set signs locally as a fallback).

### Deploy key for CI's catalog commit — `CATALOG_DEPLOY_KEY`

The `main` ruleset requires pull requests, and CI needs to push the signed catalog straight to `main`. It does so with a deploy key that has write access, which the ruleset's bypass list can allow ("Deploy keys").

1. On your machine: `ssh-keygen -t ed25519 -N "" -C "geld-ci" -f geld-ci`. This writes two files, `geld-ci` (private) and `geld-ci.pub` (public). The fingerprint and randomart it prints are informational; nothing from the terminal output is used.
2. Repo → **Settings → Deploy keys → Add deploy key**: title `geld-ci`, key = the single line in `geld-ci.pub` (`ssh-ed25519 AAAA… geld-ci`), tick **Allow write access**.
3. Secret `CATALOG_DEPLOY_KEY` = the entire contents of the private file `geld-ci`, from `-----BEGIN OPENSSH PRIVATE KEY-----` to `-----END OPENSSH PRIVATE KEY-----` inclusive (`pbcopy < geld-ci` copies it exactly).
4. Repo → **Settings → Rules → Rulesets → main → Bypass list**: tick **Deploy keys**, save.
5. Delete the local files (`rm geld-ci geld-ci.pub`); GitHub holds the only copies needed.

The commit CI pushes carries `[skip ci]`, so it does not start a second run for a change the current run already releases.

### Store credentials

Read only by the publish workflow.

### Chrome Web Store — `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`

1. `CWS_EXTENSION_ID`: the item id in the Developer Dashboard URL, `devconsole/<publisher id>/<item id>/edit` — the **second** segment, 32 lowercase letters `a`–`p` (the first segment, which contains digits, is your publisher id). It is also the id in the public listing URL.
2. Create an OAuth client: [Google Cloud Console](https://console.cloud.google.com/) → new project (any name), created while signed in as the Google account that owns the Web Store item → **APIs & Services → Library** → enable **Chrome Web Store API** → **Credentials → Create credentials → OAuth client ID**. In the wizard choose *User data* (a service account cannot publish Web Store items), leave scopes empty (the scope is requested at authorisation time), and pick application type **Desktop app** — not *Chrome Extension*, which is for code running inside an installed extension via `chrome.identity`, not for a script publishing as you. The secret is no longer shown inline: click **Download** and read `installed.client_secret` (and `client_id`) from the JSON, then delete the file.
   - If the owning account is in a Google Workspace organisation, the consent screen defaults to *Internal*: no verification, refresh tokens never expire. Nothing more to do.
   - Otherwise choose *External*, add the owning account as a test user, and click **Publish app** on the consent screen page; apps left in *Testing* expire refresh tokens after 7 days, and publishing an app only you authorise triggers no verification.
3. Get a refresh token (one-time, in a browser signed in as the owning account). Google retired the `urn:ietf:wg:oauth:2.0:oob` redirect in 2023 ("Access blocked: request is invalid"); desktop clients use a loopback address instead, which needs no registration and nothing listening on it. Open
   `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=http://localhost:8123&access_type=offline&prompt=consent&login_hint=<OWNING_ACCOUNT_EMAIL>`
   — approve; the browser lands on `http://localhost:8123/?code=…` and shows a connection error, which is expected. Copy the `code` value from the address bar (URL-decode it: `%2F` → `/`) and, within a few minutes, run
   `curl -d "client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&code=<CODE>&grant_type=authorization_code&redirect_uri=http://localhost:8123" https://oauth2.googleapis.com/token`
   with the **same** `redirect_uri`, and take `refresh_token` from the response.
   - `Error 401: invalid_client` / "The OAuth client was not found": the client id does not match one in the project — most often a client created minutes ago that has not propagated yet (wait 5–10 minutes), otherwise compare the id character for character with the credentials page or the downloaded JSON.
   - Wrong account offered: `login_hint` pre-selects it; add `&prompt=select_account%20consent` for an account chooser. `authuser=` is not honoured here.
4. The Google account must be the item's owner or a publisher in its group.

### Microsoft Edge Add-ons — `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`

[Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) → **Publish API** (left nav under your account) → **Create API credentials**. It shows the **Client ID** and a freshly generated **API key** (shown once; keys expire after 72 days by default — the page lets you set a longer expiry and create new keys). `EDGE_PRODUCT_ID` is the **Product ID** on the extension's overview page (a GUID).

### Firefox Add-ons — `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`

[addons.mozilla.org → Tools → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) → generate credentials. The **JWT issuer** (`user:…:…`) is `AMO_JWT_ISSUER`, the **JWT secret** is `AMO_JWT_SECRET`. The add-on id is fixed in the manifest (`geld@brandonmcconnell.com`) and must match the listing.

### Safari — signing secrets plus physical-device review evidence

Secrets: `APPLE_TEAM_ID`, `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY`, `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`.

Repository variables: `SAFARI_REVIEW_VIDEO_URL`, `SAFARI_REVIEW_TEST_DEVICE`.

1. `APPLE_TEAM_ID`: [developer.apple.com → Membership](https://developer.apple.com/account) → Team ID.
2. App Store Connect API key: [App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys](https://appstoreconnect.apple.com/access/integrations/api) → generate a key with the **Admin** role (cloud signing — Xcode creating provisioning profiles on the runner — is refused with "Cloud signing permission error" for App Manager keys). Note the **Key ID** (`APPLE_ASC_KEY_ID`) and **Issuer ID** (`APPLE_ASC_ISSUER_ID`); download the `.p8` (downloadable once) and store it base64-encoded: `base64 -i AuthKey_XXXX.p8 | pbcopy` → `APPLE_ASC_PRIVATE_KEY`.
3. Distribution certificates — **two** are needed for a Mac App Store `.pkg`: on your Mac, Xcode → Settings → Accounts → Manage Certificates → **+ → Apple Distribution** (signs the app) and **+ → Mac Installer Distribution** (signs the installer package; without it export fails with "No signing certificate 'Mac Installer Distribution' found"). In Keychain Access (login keychain → My Certificates) select **both** certificates, right-click → Export 2 items… → one `.p12` with a password: `base64 -i certs.p12 | pbcopy` → `APPLE_CERTIFICATE_P12`; the password → `APPLE_CERTIFICATE_PASSWORD`. Provisioning profiles are created on the fly by Xcode's cloud signing with the API key (`-allowProvisioningUpdates`), so nothing else is needed.
4. Record the complete user flow on the physical Mac used for testing, running the latest public macOS and Safari. Begin by launching Geld, then show: the containing app; Safari Settings → Extensions; enabling Geld and granting `github.com` access; `https://github.com/wxt-dev/wxt/pull/2544/files`; the corrected counts and hidden-files row; revealing the tests; the toolbar popup; and Geld's settings. Do not expose credentials or private repositories. Upload the MP4/MOV somewhere App Review can access without signing in. Set `SAFARI_REVIEW_VIDEO_URL` to that stable URL and `SAFARI_REVIEW_TEST_DEVICE` to the exact model and software, for example `14-inch MacBook Pro (2023) — macOS 26.0 (25A...), Safari 26.0`. The publish workflow refuses to submit Safari without both values, because Apple requires this evidence for the new app.
5. The job renders `store/safari-review-notes.txt` with that recording, device, version and build, writes the complete purpose/setup/services/regions disclosure into App Review Information, then uploads the build and submits it with `fastlane deliver` (release automatically after approval). Export compliance is answered as "uses no encryption" in `publish.yml` (`submission_information`); change it there if that ever stops being true.
6. The App Store record for `sh.geld.safari` must exist first, and Apple only lets the *first* version of an app be set up by hand: [App Store Connect → My Apps → + → New App](https://appstoreconnect.apple.com/apps): platform **macOS**, primary language English (U.S.), bundle ID **sh.geld.safari**, SKU e.g. `geld-safari`. On the version page fill in: category (Developer Tools), description, keywords, support URL `https://www.geld.sh/faq`, marketing URL `https://www.geld.sh`, privacy policy URL `https://www.geld.sh/privacy`, the App Privacy questionnaire, age rating, and physical-Mac screenshots as described below. Leave the build empty; the publish workflow attaches builds and submits from then on.
7. The key must be a **Team** key (Users and Access → Integrations → App Store Connect API → *Team Keys* tab); the Issuer ID is shown once at the top of that tab, not per key. Individual keys have no issuer id and will not work here.
8. Use a random passphrase for the `.p12`, never a password you use elsewhere: it is decrypted on every publishing runner.

#### Responding to Guideline 2.1 information requests

A Safari Web Extension is supposed to be submitted as a macOS containing app with an embedded extension; the presence of a normal macOS app record is not a packaging mistake. Apple’s generated containing app reports the enabled state and opens Safari Settings, while the actual product works inside Safari.

When App Review asks for more information:

1. Reply in the rejection thread with every numbered answer from `store/safari-review-notes.txt`.
2. Add the same text to **App Review Information → Notes** so future reviewers see it.
3. Attach the physical-Mac recording or provide its no-login URL.
4. Replace title-art screenshots with the physical Safari captures listed in `store/assets/safari/README.md`.
5. If only information or screenshots changed, Apple permits resubmitting the same build. If the containing app, extension, permissions, or behavior changed, upload and select a new build.

The publish workflow keeps future notes in sync through fastlane’s `app_review_information`. It will not submit Safari until the two review-evidence variables are set.

## Store listing assets

`store/assets/` holds what the listings need. Chrome/Edge promotional art is rendered from `store/assets/raw/*.html` (headless Chrome, downscaled with sharp). Mac App Store screenshots are captured from the real containing app and Safari extension on a physical Mac; title art is not a valid substitute under App Review Guideline 2.3.3.

| Asset | Path | Used by |
|---|---|---|
| Marquee screenshot 1280×800 | `chrome-edge/screenshots/00-marquee-1280x800.jpg` | Chrome, Edge, Firefox — first screenshot |
| Physical Mac screenshots | `safari/screenshots/*.jpg` | Mac App Store; capture list in `safari/README.md` |
| Marquee promo tile 1400×560 | `chrome-edge/promo/marquee-1400x560.{jpg,png}` | Chrome Web Store → Store listing → Marquee promo tile |
| Small promo tile 440×280 | `chrome-edge/promo/small-440x280.{jpg,png}` | Chrome Web Store → Store listing → Small promo tile |

**Getting them onto the stores.** Only two stores accept listing assets through an API, and the `Store listings` workflow (Actions → Store listings → Run workflow) handles those, idempotently: Firefox (the 1280×800 marquee becomes AMO preview 0) and the Mac App Store (`fastlane deliver` uploads the physical captures in `safari/screenshots/` to the current App Store Connect version). With no physical captures committed, the Safari job skips instead of replacing real screenshots with title art. Run it after changing an asset. **Chrome and Edge have no API for listing assets**, so theirs are set once by hand:

- Chrome Web Store: [developer dashboard](https://chrome.google.com/webstore/devconsole) → Geld → *Store listing*: upload `chrome-edge/screenshots/00-marquee-1280x800.jpg` as the **first** screenshot (the listing page's carousel shows screenshots only; promo tiles appear in store discovery, not on the listing), `chrome-edge/promo/small-440x280.png` as the small promo tile and `chrome-edge/promo/marquee-1400x560.png` as the marquee promo tile, then *Save draft* → *Submit for review* (listing-only changes are reviewed quickly and do not touch the published package).
- Edge Add-ons: [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge) → Geld → *Store listings* → English: `00-marquee-1280x800.jpg` as the first screenshot, `small-440x280.png` under *Promotional tiles* (small), `marquee-1400x560.png` (large), then *Save* and *Publish*.

Demo video: `https://www.youtube.com/watch?v=Ma1QC9JYnD4` — Chrome and Edge have a "YouTube video URL" field on the store listing; Firefox and the App Store have none (App Store *previews* are uploaded video files), so put the link in the description there.
