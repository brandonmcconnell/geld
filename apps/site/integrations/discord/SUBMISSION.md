# Geld for Discord: registering the app and its bot

Everything here is for the owner to do in Discord's developer portal. The extension's side is `apps/extension/src/lib/discord-connect.ts`; the shared logic, including the permission check, is `packages/review/src/link-resolvers/discord.ts`; the site's is the resolver (`/api/discord/resolve`), the token proxy (`/api/connect/discord/token`), the callback page (`/connect/discord/callback`) and `/integrations/discord`.

## Why it works this way

Discord has no API for reading messages as a person: only bots read messages, and only in servers that added them. So a reader signs in with Discord for `identify` and `guilds` only, and Geld's resolver on geld.sh, which holds the bot's token, reads a linked message only after it has checked, for that reader:

1. who the token belongs to (`/users/@me`),
2. that they are a member of the server (`/guilds/{id}/members/{user}`, as the bot),
3. that their roles and the channel's overwrites give them View Channel and Read Message History (`channelPermissions`, Discord's own algorithm; a thread uses its parent's).

The resolver stores and logs nothing, and every refusal reads as no access.

## 1. Create the application

1. https://discord.com/developers/applications → New Application, name Geld, icon from `assets/brand/`.
2. OAuth2:
   - Redirects: `https://www.geld.sh/connect/discord/callback`.
   - Leave **Public Client** off: the token exchange happens in Geld's token proxy with the client secret (and PKCE).
   - Copy the client id and reset and copy the client secret.
3. Bot:
   - Reset and copy the token.
   - **Public Bot** on, so server admins can add it from the invite link.
   - Privileged Gateway Intents: turn on **Message Content** (without it, message text reads empty and titles fall back to the channel name). Leave Presence and Server Members off; the resolver reads a member over REST, which needs no intent.
4. Installation: install link "None" (Geld gives its own invite link with exactly View Channels and Read Message History, `DISCORD_BOT_PERMISSIONS` = 66560).
5. General information: terms and privacy `https://www.geld.sh/privacy`, a short description.

## 2. Wire it

- Vercel, project `geld-site`, Production: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`. The site's integration page shows the invite link once `DISCORD_CLIENT_ID` is set at build time.
- Repository Actions variable `WXT_GELD_DISCORD_CLIENT_ID` (same client id), and `apps/extension/.env` for local builds.
- Cursor secrets with the same names for end-to-end testing.

## 3. Check it

1. Add the bot to a test server with the invite link from `/integrations/discord` (or the options page).
2. In the extension, turn on Connected services and Connect Discord.
3. Open a pull request whose description links a message in that server. Related links shows the message; a channel your test account cannot see reads as nothing at all.

## 4. Verification (later)

An unverified bot can be in at most 100 servers, and the Message Content intent is granted freely below that.
At 75 servers Discord invites the owner to verify the bot (identity verification of the team owner) and to apply for the Message Content intent, explaining the use: Geld reads one message a person explicitly linked from a pull request, only for a member who may already read it, and stores nothing.
The privacy policy's Connected services section and `/integrations/discord` say the same, and should be linked in the application.
