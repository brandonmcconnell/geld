# Releasing Geld to the stores

How a version gets from `main` to Chrome, Edge, Firefox and Safari users, what has to be done once by hand, and what runs by itself afterwards. Listing text and form answers live in [`listing.md`](./listing.md); artwork specs and prompts in [`image-prompts.md`](./image-prompts.md).

## The loop, once everything is set up

1. Open a pull request. If it touches `apps/extension`, `packages/core`, `assets/brand` or the lockfile, run `pnpm bump patch` (or `minor` / `major`) in it. That edits `apps/extension/package.json`, which is the only place the version lives: WXT copies it into every manifest and the site reads it for the version badge.
2. CI's `extension-version` job fails the pull request if those paths changed and the version is unchanged, lower than `main`'s, or already tagged. Label the PR `no-release` for a change that must not ship on its own (a comment fix, a test). Site-only PRs are never checked.
3. Merge. The `Release` workflow runs on the push to `main`, sees a version with no `v<version>` tag, and:
   - runs typecheck + tests for core and the extension, builds the four zips plus the Firefox sources zip, and checks each packaged manifest carries the version;
   - creates the tag and a GitHub Release with auto-generated notes and the zips attached (the geld.sh install buttons follow the latest release until a store URL is set in `apps/site/lib/downloads.ts`);
   - submits to every store whose secrets are configured, one job per store, so one store failing never blocks another. Re-run the failed job after fixing the cause (usually an expired Edge key).
   - Safari is a separate, opt-in job (see below).
4. The stores review and publish on their own schedule: Firefox within minutes (automatic signing, human review afterwards), Chrome hours to days, Edge one to seven business days, Apple one to two days.

Nothing edits the version for you. That is deliberate: a bot commit on `main` after a merge would race the merge queue and re-trigger CI, and the GitHub merge queue cannot rewrite the commits it merges. The check turns "I forgot" into a red PR instead.

`Actions > Release > Run workflow` with **dry run** ticked builds everything and asks each configured store to authenticate without uploading, tagging or releasing. Use it right after adding a store's secrets.

## What only a person can do

Every store requires the very first submission to be made by hand in its dashboard: the item does not exist until you upload a zip and fill in the listing, and the IDs the API needs are minted at that point. Automation in this repository cannot sign in to your Google, Microsoft, Mozilla or Apple accounts (two-factor, payment, legal declarations), so plan for one sitting per store with `listing.md` open next to it. After that, the workflow handles every update.

### Chrome Web Store (one time)

1. <https://chrome.google.com/webstore/devconsole>: pay the US$5 fee, verify the contact email, set the publisher name, declare non-trader status.
2. Add new item → upload `geld-<version>-chrome.zip` → fill the Store listing, Privacy and Distribution tabs from `listing.md` → Submit for review. Note the 32-letter **item ID** in the URL.
3. Publisher > Settings: note the **publisher ID**.
4. Google Cloud Console (any project): enable the *Chrome Web Store API*, create a **service account** (no IAM roles needed), create a JSON key for it. Back in the dashboard, under **Account**, add the service account's email; that grants it the API for every item your publisher owns.
5. Repository secrets: `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` (`client_email` from the JSON), `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` (`private_key` from the JSON, including the BEGIN/END lines and newlines).

The workflow uses API v2 (`CHROME_API_VERSION=v2`). v1.1 with OAuth client + refresh token still works until 15 October 2026, after which only v2 answers; do not set it up. Publishing through the API keeps the visibility you last published with manually; if you change visibility in the dashboard, publish once by hand afterwards.

### Microsoft Edge Add-ons (one time)

1. <https://partner.microsoft.com/dashboard/microsoftedge>: register (free), declare non-trader status.
2. Create new extension → upload `geld-<version>-edge.zip` → Availability, Properties, Privacy, Store listings → Notes for certification → Publish. The product page URL holds the **Product ID** (GUID).
3. Partner Center > Publish API: *Create API credentials*. Copy the **Client ID** and the **API key** (shown once).
4. Repository secrets: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`.

The API key **expires every 72 days** and there is no API to renew it; Microsoft emails you beforehand. When the Edge job fails with 401, create a new key in Partner Center, update the secret, re-run the job. Consider a calendar reminder.

### Firefox Add-ons (one time)

1. <https://addons.mozilla.org/developers/>: sign in (Mozilla account with 2FA), Submit a New Add-on → *On this site*.
2. Upload `geld-<version>-firefox.zip`, answer **Yes** to source code and upload `geld-<version>-sources.zip` (after this branch it contains the whole monorepo so reviewers can run `pnpm install --frozen-lockfile && pnpm zip:firefox`). Fill the Describe page from `listing.md`.
3. <https://addons.mozilla.org/developers/addon/api/key/>: generate credentials → **JWT issuer** and **JWT secret**.
4. Repository secrets: `FIREFOX_EXTENSION_ID` = `geld@brandonmcconnell.com` (the `gecko.id` in `wxt.config.ts`; AMO uses it, not the slug), `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`.

Updates through the API also upload the sources zip and set the version's release notes to the GitHub Release body.

### Safari / Mac App Store (one time, then opt in)

Needs an Apple Developer Program membership (US$99/year) and a Mac with Xcode 26 for the first pass. The CI job has not been exercised end-to-end (no macOS runner is available to automation here), so treat the first run as a debugging session.

1. Locally: `pnpm --filter @geld/extension build:safari`, then
   `xcrun safari-web-extension-converter apps/extension/.output/safari-mv3 --project-location apps/extension/.output/safari-xcode --app-name Geld --bundle-identifier sh.geld.Geld --macos-only --copy-resources`.
   Open the project in Xcode, set your team, add a 1024×1024 app icon to `AppIcon`, confirm App Sandbox is on and the category is Developer Tools. Product > Archive > Distribute App > App Store Connect, then finish the listing in App Store Connect from `listing.md` and submit for review. This first upload is what creates the app record the API later needs.
2. developer.apple.com: App IDs `sh.geld.Geld` and `sh.geld.Geld.Extension`; two *Mac App Store Connect* provisioning profiles; export "3rd Party Mac Developer Application" and "3rd Party Mac Developer Installer" certificates as one `.p12`.
3. App Store Connect > Users and Access > Integrations > App Store Connect API: team key, role App Manager; download the `.p8` (once).
4. Repository **variables**: `SAFARI_PUBLISH=true`, `APPLE_BUNDLE_ID=sh.geld.Geld`, `APPLE_TEAM_ID`, `APPLE_APP_SIGNING_IDENTITY` (`3rd Party Mac Developer Application: Brandon McConnell (TEAMID)`), `APPLE_INSTALLER_SIGNING_IDENTITY` (`3rd Party Mac Developer Installer: …`).
   Repository **secrets**: `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_MACOS_PROVISIONING_PROFILE_BASE64`, `APPLE_MACOS_EXTENSION_PROVISIONING_PROFILE_BASE64`, `APPLE_API_KEY` (base64 of the `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

The `safari` job then converts the fresh build on a `macos-26` runner, writes the version into the Xcode project (`MARKETING_VERSION` = manifest version, `CURRENT_PROJECT_VERSION` = the workflow run number so every upload is a new build), signs and uploads with [`rxliuli/safari-webext-publish-action`](https://github.com/rxliuli/safari-webext-publish-action), and `safari-submit` creates the App Store version, attaches the build, sets "What's New" from the release notes and submits for review. The 1024 px icon is the known gap: the converter has nothing to fill that slot with, so either commit the generated Xcode project (then the workflow should build from it instead of re-converting) or add a step that copies a committed `AppIcon.appiconset` over the generated one. Decide that during the first real run.

## Secrets at a glance

| Store | Secrets | Also |
| --- | --- | --- |
| Chrome | `CHROME_EXTENSION_ID` `CHROME_PUBLISHER_ID` `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | API v2 is set in the workflow |
| Edge | `EDGE_PRODUCT_ID` `EDGE_CLIENT_ID` `EDGE_API_KEY` | key expires every 72 days |
| Firefox | `FIREFOX_EXTENSION_ID` `FIREFOX_JWT_ISSUER` `FIREFOX_JWT_SECRET` | sources zip is uploaded too |
| Safari | `APPLE_*` secrets above | variables `SAFARI_PUBLISH`, `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_*_SIGNING_IDENTITY` |
| Build | — | variable `WXT_GITHUB_CLIENT_ID` (already used by CI) |

A store with any secret missing is skipped with a notice in the run summary, never failed.

## Local equivalents

- `pnpm bump patch|minor|major` — bump `apps/extension/package.json` (no git tag, no commit).
- `pnpm zip:all` — the same zips the workflow uploads.
- `pnpm --filter @geld/extension exec wxt submit init` — interactive helper that writes a git-ignored `.env.submit` with the same variable names, for submitting from a laptop with `pnpm --filter @geld/extension exec wxt submit --chrome-zip … --firefox-zip … --firefox-sources-zip … --edge-zip …`. Add `--dry-run` to only check credentials.

## Alternatives considered for the version

- **Bump inside the merge queue.** Not possible: GitHub's merge queue runs checks on a temporary merge commit and merges exactly that commit; nothing can add to it.
- **Bot commit on `main` after merge** (bump + tag + release). Works, but produces a second commit per merge, needs a token that can bypass branch protection, and races the queue when two PRs merge close together. Available if the PR-time bump ever feels like friction: replace the `extension-version` job with a workflow that bumps and commits on `push` to `main`, and leave `release.yml` as is (it only looks at the version).
- **Changesets / release-please.** Both produce a "release PR" that you merge to cut a version. Good for changelog discipline, but that PR is exactly the manual step being avoided.
- **Tag-driven releases** (`git tag v1.2.3 && git push --tags`). Simple, but the tag can disagree with `package.json`; the version-in-file approach keeps one source of truth.
