# Publishing Geld to the stores

Every push to `main` that touches the extension produces a GitHub Release (see `.github/workflows/ci.yml`) whose zips carry a **four-part version**: the version in `apps/extension/package.json` plus the CI run number, e.g. `0.1.1.68`. Stores only require the version to increase, so no bump commit is needed between store releases; change `package.json` only when the marketing version should change.

Publishing to the stores is a separate, deliberate step: **Actions → "Publish to stores" → Run workflow** (`.github/workflows/publish.yml`). Pick a release tag (default: latest) and the channels. Stores review every submission, and Chrome, Edge and Apple refuse a new submission while one is under review, so publish batches rather than every push. A store that reports a pending review is *skipped* with a warning, not failed — run the workflow again once the review is through.

| Store | What the job does | Review |
|---|---|---|
| Chrome Web Store | uploads the zip, publishes to the default (public) target | hours–days |
| Edge Add-ons | uploads to the draft, submits it with the notes | 1–7 days |
| Firefox AMO | `web-ext sign --channel listed` with the sources zip | usually minutes (auto-approval) |
| Safari | macOS runner: `safari:sync`, `xcodebuild archive`, export + upload to App Store Connect | 1–2 days; submitting the uploaded build for review is still done in App Store Connect |

## Secrets

Add these under **Settings → Secrets and variables → Actions → New repository secret**. None of them are needed for CI itself; only the publish workflow reads them.

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

### Safari — `APPLE_TEAM_ID`, `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY`, `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`

1. `APPLE_TEAM_ID`: [developer.apple.com → Membership](https://developer.apple.com/account) → Team ID.
2. App Store Connect API key: [App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys](https://appstoreconnect.apple.com/access/integrations/api) → generate a key with the **App Manager** role. Note the **Key ID** (`APPLE_ASC_KEY_ID`) and **Issuer ID** (`APPLE_ASC_ISSUER_ID`); download the `.p8` (downloadable once) and store it base64-encoded: `base64 -i AuthKey_XXXX.p8 | pbcopy` → `APPLE_ASC_PRIVATE_KEY`.
3. Distribution certificate: on your Mac, Xcode → Settings → Accounts → Manage Certificates → **+ → Apple Distribution**. Then in Keychain Access export that certificate (with its private key) as a `.p12` with a password: `base64 -i cert.p12 | pbcopy` → `APPLE_CERTIFICATE_P12`; the password → `APPLE_CERTIFICATE_PASSWORD`. Provisioning profiles are created on the fly by Xcode's cloud signing with the API key (`-allowProvisioningUpdates`), so nothing else is needed.
4. The job uploads the build to App Store Connect. Attaching it to a version and pressing **Submit for Review** is still manual in App Store Connect until we wire `fastlane deliver --submit_for_review` (needs the same API key). The workflow skips Safari with a warning until these secrets exist.

## Store listing assets

`store/assets/` holds what the listings need. All rendered from `store/assets/raw/*.html` (headless Chrome, downscaled with sharp); re-render when the copy or brand changes.

| Asset | Path | Used by |
|---|---|---|
| Marquee screenshot 1280×800 | `chrome-edge/screenshots/00-marquee-1280x800.jpg` | Chrome, Edge, Firefox — first screenshot |
| Marquee screenshot 2880×1800 | `safari/screenshots/00-marquee-2880x1800.jpg` | Mac App Store — first screenshot |
| Marquee promo tile 1400×560 | `chrome-edge/promo/marquee-1400x560.{jpg,png}` | Chrome Web Store → Store listing → Marquee promo tile |
| Small promo tile 440×280 | `chrome-edge/promo/small-440x280.{jpg,png}` | Chrome Web Store → Store listing → Small promo tile |

Demo video: `https://www.youtube.com/watch?v=Ma1QC9JYnD4` — Chrome and Edge have a "YouTube video URL" field on the store listing; Firefox and the App Store have none (App Store *previews* are uploaded video files), so put the link in the description there.
