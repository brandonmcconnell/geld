---
name: Geld Dashboard and Review
overview: 'Build the independent Geld dashboard in apps/dashboard with provider-neutral access, AI-guided review and per-seat billing.'
isProject: false
---
# Geld dashboard implementation

The consolidated November 1, 2026 handoff supersedes earlier architecture decisions.
The dashboard is a separate Next.js application, never an extension page or a route inside the marketing site.
Better Auth on Postgres handles accounts, while identity and repository GitHub Apps stay separate.
Guides always use AI and consume credits.
Core review writes, teams, access, assignments, billing, privacy and Enterprise support belong to V1.
Projects and roadmaps are disabled scaffolding, and initiatives and active-author billing are deferred.

See [architecture](../../docs/dashboard/architecture.md) and [data inventory](../../docs/dashboard/data-inventory.md) for the implementation boundaries.

The linear stack proceeds through foundation, provider clients, dashboard and authentication, review and writes, collaboration and billing, and integrations and deployment preparation.
Live services are optional during local development, with explicit demo fixtures and unavailable responses for missing configuration.
No demo authentication or write adapter may be enabled in a hosted production environment.
Each slice must pass its package checks, and the complete stack must pass `pnpm check`.
Dashboard CI is temporarily advisory during rollout.
Once the dashboard is fully rolled out, restore its checks as required CI and remove the temporary success-or-skipped handling in `.github/workflows/ci.yml`, so dashboard failures block CI again.
Until the dashboard launches, the extension's account control offers only GitHub sync, as geld.sh does since #337: the "Sign in to Geld" control #151 added was taken out of `apps/extension/src/ui/account-widget.ts` in #352.
At launch, bring it back as the extension's one sign-in, replacing GitHub sync, since settings sync then lives in the Geld account. Restore `account-widget-session.test.ts` from #151 with it. `dashboard-session.ts` and the tracker links stay in place meanwhile, idle without a session. The background drops any Geld session an earlier build saved (`retireDashboardSession`, on install and update), so remove that call at launch too.
Publishing, merging, paid plans, live billing and real-data migrations remain owner actions.


## Review experience direction (November 2026)

Continue from the top of the dashboard stack. Keep the public website on its legacy settings flow until rollout.

The review experience should make decisions easier across GitHub, GitLab and Bitbucket: preserve cached results during navigation, give change counts a stable place, and render descriptions and discussion as readable GitHub-flavored Markdown. Expandable diff context and source links must stay tied to the reviewed revision. Keep the compact sidebar, square controls and cut-corner buttons; introduce depth through restrained lighting and surface contrast rather than extra decoration or copy.

The next product slices should extend the existing trusted digest with normalized CI checks, review-request states, reviewer avatars and provider timeline events. Carry the most useful signals into queue rows, expose incomplete or stale data explicitly, and let reviewers choose a digest or full timeline. The current discussion view does not yet include every provider event. Agentic review and the assistant should share that context, stream Markdown, and make proposed actions reviewable. These features require provider contracts and permission checks, not decorative placeholder data.
