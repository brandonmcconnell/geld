# `/api/auth/github` — reserved, not implemented

This directory is a placeholder for the settings-sync sign-in. There is intentionally no `route.ts` here yet, so nothing is served at this path and the site stays fully static.

## Intended design

- The extension's options page starts a GitHub OAuth flow (scope: `gist` only).
- GitHub redirects back to **this route** with the authorization `code`. The route's only job is to exchange the code for an access token using the app's client secret (kept as a Vercel environment variable) and hand the token back to the extension. It must not store the token or log it.
- Settings are **encrypted client-side** in the extension (key derived from a user passphrase, never sent anywhere) and stored in a **secret Gist in the user's own account**. Sync = read/write that Gist with the user's token.
- The site never sees settings, plaintext or ciphertext, and never sees the token after the exchange. No database, no sessions.

When implementing: add `route.ts` here exporting `GET`/`POST`, use the default Node.js runtime (Fluid Compute), validate the `state` parameter, and keep this README's constraints. Everything else on the site remains prerendered.
