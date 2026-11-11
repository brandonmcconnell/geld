# Accounts

The hub has no accounts of its own. It signs people in to their Geld account, the one the dashboard and the extension use, so a person signed in at one Geld app is signed in at the others.

## What is shared

Five tables, with the names and quoted camelCase columns Better Auth writes for the dashboard: `users`, `sessions`, `identities`, `verifications` and `rateLimit`.
The dashboard's migrations (`apps/dashboard/db/migrations`) create them in a shared database.
The hub declares the same tables in `src/db/schema.ts` so a database it has to itself (local development, demo mode, tests) gets them too, and its first migration makes every statement on them a no-op when they already exist.
`src/lib/shared-accounts.test.ts` applies both sets of migrations and fails when the two declarations differ, in either order.

The hub's own tables are prefixed `hub_` and its migrations are tracked in the `drizzle` schema, apart from the dashboard's `geld_migrations`.
`db:migrate -- --reset` empties the whole database and therefore refuses any database that is not on this machine.

## What must match

`sharedAccountOptions` in `src/lib/auth.server.ts` holds the options both apps must agree on. Change them only together with `apps/dashboard/lib/auth.ts`.

| Option | Value | Why |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | The same secret in both apps | It signs the session cookie and encrypts provider tokens |
| Cookie | Prefix `geld`, on `.geld.sh` when the app is served from a `geld.sh` host | One cookie for every Geld host. On any other host (localhost, a preview) the cookie stays on that host |
| Table names | `users`, `sessions`, `identities`, `verifications` | The dashboard's |
| Provider tokens | Encrypted (`account.encryptOAuthTokens`) | Rows the hub writes itself go through `sealToken`, rows it reads through `openToken` (`src/lib/account-tokens.server.ts`) |
| Account linking | By verified email only | A GitHub account joins an existing Geld account only when GitHub has verified the same address |
| Sessions | No IP address or user agent stored | As the dashboard's |
| Better Auth version | The dashboard's (1.7.15) | Two versions would have to agree on the cookie and row formats by luck |

## GitHub on a Geld account

| Identity (`providerId`) | What it is | Used for |
| --- | --- | --- |
| `github-oauth` | The GitHub OAuth app, scopes `read:user`, `repo`, `read:org`, `user:email` | Sign-in from the hub, and reads where the GitHub App is not installed |
| `github-repository` | A user authorization of the repository GitHub App | Installation discovery and app-scoped access |

Both ids are the dashboard's, so one row serves both apps. For that to hold in a shared database the hub must be configured with the same OAuth app and the same GitHub App as the dashboard: a refresh token belongs to the app that issued it.

"Continue with GitHub" signs in with `github-oauth`. Someone who is already signed in to Geld another way (email, another provider) arrives with a session and no GitHub: the setup page then offers "Connect GitHub", which adds the identity to their account.

## Connections

Settings, Connections lists the Git providers on the account: GitHub, GitLab and Bitbucket. Connecting one adds the dashboard's identity for it (`github-oauth`, `gitlab`, `bitbucket`), so a connection made in either app is one connection.

GitLab and Bitbucket are offered only when this server has their OAuth app (`GITLAB_CLIENT_*`, `BITBUCKET_CLIENT_*`). A provider connected elsewhere that this server lacks is shown as connected and cannot be read here, since refreshing its token needs the app.

`providerClientFor(userId, provider)` in `src/lib/providers/connections.server.ts` gives the shared client from `@geld/providers` for a connection. Its token comes through Better Auth, which decrypts it and refreshes an expired one. The page asks each connected provider for its first page of repositories to say whether the connection still works.

GitHub's own screens still read through the app's GitHub client. GitLab and Bitbucket pull requests are not in the lists yet.

## Not here yet

- The dashboard's other ways to sign in (email code, magic link, password, single sign-on). Their sessions work in the hub. GitLab and Bitbucket can be connected to an account but do not start a sign-in from the hub's own page.
- Disconnecting a provider. It stays on the dashboard with the rest of account management.
- Account deletion and export. They stay on the dashboard, which runs the erasure steps.
- The hub does not encrypt `idToken` as the dashboard does. None of its providers issues one (GitLab is asked for `read_user` and `api`, not `openid`). A provider that does must not be added before that is copied.
