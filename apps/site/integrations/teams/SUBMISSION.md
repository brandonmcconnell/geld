# Geld for Microsoft Teams: registering the app

Everything here is for the owner to do in the Microsoft Entra admin center. The extension's side is `apps/extension/src/lib/teams-connect.ts` and `packages/review/src/link-resolvers/teams.ts`; the site's is the token proxy (`/api/connect/teams/token`, `lib/connect-token.ts`), the callback page (`/connect/teams/callback`) and `/integrations/teams`.

## 1. Register the app

1. https://entra.microsoft.com → Identity → Applications → App registrations → New registration.
   - Name: Geld.
   - Supported account types: **Accounts in any organizational directory (multitenant)**. Personal Microsoft accounts have no Teams channels to read.
   - Redirect URI: platform **Web**, `https://www.geld.sh/connect/teams/callback`.
2. Certificates & secrets → New client secret (24 months). Copy its value.
3. API permissions → Add → Microsoft Graph → **Delegated**: `User.Read`, `ChannelMessage.Read.All`, `Channel.ReadBasic.All`, `Team.ReadBasic.All`, `offline_access`. Do not add application permissions: Geld only ever reads as the signed-in person.
4. Branding & properties: home page `https://www.geld.sh/integrations/teams`, terms and privacy `https://www.geld.sh/privacy`, the logo from `assets/brand/`.

## 2. Wire it

- Vercel, project `geld-site`, Production: `MICROSOFT_CLIENT_ID` (the Application (client) ID) and `MICROSOFT_CLIENT_SECRET`. The token proxy answers 503 without them.
- Repository Actions variable `WXT_GELD_TEAMS_CLIENT_ID` (same client id), and `apps/extension/.env` for local builds.
- Cursor secrets with the same names, so an agent can test the flow end to end.
- Put a reminder in the calendar for the secret's expiry: an expired secret stops every refresh, and connections then read as signed out.

## 3. Verify the publisher

Multitenant apps show "unverified" on the consent screen until the publisher is verified, and many organisations block unverified apps.

1. Join the Microsoft AI Cloud Partner Program (Partner Network) with the business that publishes Geld, and finish its verification.
2. In the app registration, Branding & properties → Publisher verification → add the Partner One ID.
3. The publisher domain must be verified too (`geld.sh`, through the `.well-known/microsoft-identity-association.json` file Entra gives, served by the site).

## 4. Admin consent

`ChannelMessage.Read.All` (delegated) needs a tenant admin's consent. Readers whose admin has not consented see Microsoft's "Need admin approval" screen.

- The admin consent link for an organisation is `teamsAdminConsentUrl(clientId)` in `apps/site/lib/integrations.ts`: `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=…&scope=…&redirect_uri=https://www.geld.sh/connect/teams/callback`.
- `/integrations/teams` tells readers to send it to their admin.

## 5. Check it

1. Build the extension with the client id, turn on Connected services, choose Connect Microsoft Teams and sign in with a work account in a test tenant (a Microsoft 365 developer tenant works).
2. Open a pull request whose description links a channel message (`teams.microsoft.com/l/message/…?groupId=…`). Related links shows the message and its reply count; the eye opens the thread.
3. Wait an hour: the next read renews the token through the proxy without signing in again.

No Teams Store or AppSource listing is needed: Geld reads through Microsoft Graph and adds nothing to Teams itself.
