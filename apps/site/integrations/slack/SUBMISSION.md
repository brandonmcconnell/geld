# Geld for Slack: registering and submitting the app

Everything here is for the owner to do in Slack's app settings. The code that uses the app is already in the extension (`apps/extension/src/lib/slack-connect.ts`) and on the site (`/connect/slack/callback`, `/integrations/slack`, `/support`).

## 1. Create the app

1. Go to https://api.slack.com/apps, choose **Create New App**, then **From a manifest**, and pick the workspace that will own the app (use one you control, not a customer's).
2. Paste `manifest.json` from this folder.
3. Under **OAuth & Permissions**, turn on **PKCE**.
   This marks the app as a public client, which Slack cannot undo without support. It is what lets the extension sign in with no client secret anywhere.
   Leave **Token rotation** off: with PKCE and rotation off, a user token does not expire, so nothing has to refresh it.
4. Under **Manage Distribution**, complete the checklist and choose **Activate Public Distribution**.
   This makes the app installable from Geld's Connect Slack button in any workspace, before any Marketplace listing.
5. Copy the **Client ID** (Basic Information). The client secret is not used anywhere: do not add it to Vercel or the extension.

## 2. Wire the client id

- Repository Actions variable: `WXT_GELD_SLACK_CLIENT_ID` (Settings, Secrets and variables, Actions, Variables). CI and the publish workflow pass it to the extension build.
- Local builds: `WXT_GELD_SLACK_CLIENT_ID=` in `apps/extension/.env` (see `.env.example`).
- Cursor secret `WXT_GELD_SLACK_CLIENT_ID`, so an agent can build the extension and test Connect Slack end to end.

Without the id, the options page shows Slack as not available in this build.

## 3. Check it

1. Build the extension with the id and load it.
2. Options, Experiments: turn on Connected services.
3. Connected services, Slack: Connect Slack workspace. Allow the browser prompt (slack.com and www.geld.sh), approve in Slack, and the tab closes by itself.
4. Open a pull request whose description links a Slack thread in that workspace. Related links shows the thread's first message, its reply count, and the eye opens the thread.
5. Remove the connection: Slack's **Installed apps** for your account no longer lists the token (it is revoked with `auth.revoke`).

## 4. Marketplace submission (later)

Until the app is approved, Slack allows it about one `conversations.replies` / `conversations.history` call a minute per workspace. The extension spaces those calls (`SLACK_READ_INTERVAL_MS` in `apps/extension/src/lib/connections.ts`) and shows "Shortly" on a row that is waiting.
After approval, lower `SLACK_READ_INTERVAL_MS` to about `1_200` (Tier 3, 50 a minute).

Before submitting, check Slack's current Marketplace guidelines and API terms; these are the parts known to apply:

- **Active installs:** Slack has asked for a minimum number of active workspaces (about 10) before review. Confirm the current number.
- **Pages:** landing page `https://www.geld.sh/integrations/slack`, support page `https://www.geld.sh/support`, privacy policy `https://www.geld.sh/privacy#connected-services`.
- **Support contact:** `support@geld.sh` must route to someone before submitting (the site already shows it).
- **Listing copy:** the manifest's `description` and `long_description`. Categories: Developer tools, Productivity.
- **Icon and screenshots:** a 512 × 512 icon from `assets/brand/` on its tile (as the store icons), and screenshots of Related links with Slack titles and of the thread dialog, taken on a real pull request in a test workspace.
- **Scope reasons:** `apps/site/lib/integrations.ts` (`SLACK_SCOPE_REASONS`), the same words the integration page shows.
- **Data use and AI:** Slack's API terms restrict storing Slack data and using it with AI models. State that Geld stores nothing on any server, caches what it read on the reader's device for a day, and sends a thread to an AI model only when the reader turned on AI context for that connection and runs Triage with AI, to the reader's own gateway, for that request only, with no training. If Slack's terms then in force do not allow that, remove AI context for Slack before submitting (`purpose: 'ai'` is refused per service in `candidatesFor`).
- **Reviewer test steps:** give reviewers a test workspace with a channel and a thread, a public test repository with a pull request that links the thread, the extension build to install (the latest GitHub Release, or the Chrome Web Store), and steps 2 to 5 above.

## 5. After approval

- Lower `SLACK_READ_INTERVAL_MS`.
- Move the Connected services switch out of Experiments (`packages/core/src/settings-schema.ts`) when the other services are ready too.
