# Dashboard deployment

The dashboard has its own Vercel project, `geld-dashboard`, in the `dreamthinkbuild` team. `geld-site` remains the marketing project.

## Vercel settings

- Framework: Next.js
- Root directory: `apps/dashboard`
- Include source files outside the root directory: enabled
- Node.js: 24.x
- Install command: `cd ../.. && corepack pnpm install --frozen-lockfile`
- Build command: `corepack pnpm verify:icons && corepack pnpm build`

`verify:icons` imports Sharp Regular, Sharp Solid, Utility and Utility Fill directly from the installed Kit and checks required SVG definitions. Utility Duo is not used. Git workflow icons are checked in Sharp because the Utility catalog does not include them all.

## Private package access

The dashboard pins `@awesome.me/kit-2e791c163e` to `1.0.4` as a runtime dependency. The root `.npmrc` reads `FONTAWESOME_PACKAGE_TOKEN` from the process environment. Never commit its value or use a `NEXT_PUBLIC_` variable. An application `.env.local` does not automatically provide a variable to pnpm before installation.

Configure the token in these places:

- Vercel: `geld-dashboard` environment variables for Preview, Production and Development. Other Vercel projects using a full workspace install, including `geld-site`, also need registry access.
- GitHub: repository Actions secret named `FONTAWESOME_PACKAGE_TOKEN`. The install steps consume it; it is not intentionally passed to application builds.
- Local or cloud development: an injected environment secret or exported shell variable before `corepack pnpm install --frozen-lockfile`.

Restricted networks must allow `npm.fontawesome.com` and the download host `dl.fontawesome.com`. Keep authentication scoped to the registry host as configured in `.npmrc`.

Forks do not receive repository secrets. Contributors building the dashboard need their own licensed package access. Do not use `pull_request_target` to expose the token to fork code.

## Application services

Package access only enables dependency installation. The application still needs the account, database, email and integration settings listed in `apps/dashboard/.env.example` for their corresponding features. Configure those with deployment-specific values before enabling real sign-in, billing or provider connections. Local fixture screenshots do not validate those services.
