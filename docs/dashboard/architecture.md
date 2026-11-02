# Dashboard architecture

The dashboard is an independent product in `apps/dashboard`, deployed separately from `apps/site`.
The site, extension and Action continue to work independently.
Shared domain rules live in `@geld/domain`, provider access in `@geld/providers` and `@geld/github`, review plans in `@geld/review`, and presentation primitives in `@geld/ui`.

## Request boundaries

Next.js route handlers authenticate with Better Auth before database or provider access.
Every provider operation obtains credentials through a token source, retries an expired credential once, and returns typed permission and rate-limit failures without provider response bodies.
Interactive provider requests can execute in a browser adapter when a provider supports CORS and a safe device credential is available.
Server handlers use encrypted stored credentials otherwise.
No credential is returned from a dashboard API.
Database queries are parameterized and scoped by authenticated user and team membership.
Team administration never substitutes for a provider permission.

## Resource identity and navigation

Provider identity is `(provider, host, external_id)` rather than a GitHub-only identifier.
PR URLs are `/github/{org}/{repo}/pull/{number}`, `/gitlab/{org}/{repo}/pull/{number}` and `/bitbucket/{workspace}/{repo}/pull/{number}`.
GitLab nested namespaces use a single percent-encoded namespace segment.
Enterprise URLs are `/ghe/{host}/{org}/{repo}/pull/{number}` for both direct and relay transport.
An Enterprise Cloud instance on github.com uses the ordinary GitHub route.
Provider organisation and repository routes are read-only navigation indexes.
Settings use a final `~settings` segment, which cannot be a provider repository slug.
Sources: [GitHub naming rules](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [GitLab slug rules](https://docs.gitlab.com/user/reserved_names/), [Bitbucket repository setup](https://support.atlassian.com/bitbucket-cloud/docs/create-a-repository/).
URLs never contain a Geld team or project for a PR.

## GitHub Apps

The existing App becomes the identity App, with verified email read and gist sync permissions.
Repository Apps are indexed by a canonical permission fingerprint and reused for matching installations.
The review permission set reads metadata, contents, checks and statuses, and writes pull requests and issues.
Merging additionally requires contents write.
Access management additionally requires organisation members write and repository administration write.
Repository settings and destructive operations require the corresponding provider capability and an explicit user action.
Manifest creation requires owner confirmation in GitHub.
State is signed, single-use, expires after ten minutes, and is tied to the requesting actor.
An installation replacement follows prepare, install, verify, migrate and retire.
Retirement is allowed only after the new installation is verified and grants are reconciled.
Cancellation leaves the previous installation active.

## Access and jobs

Effective repository access is Geld entitlement intersected with current provider access.
Sync is nested beneath managed access and starts disabled.
Outside collaborators always use direct repository grants and are never invited to provider organisations.
Each grant snapshots the previous permission and tracks pending, active, revoking, revoked or drifted state.
Only confirmed Geld-owned grants are revoked automatically.
Membership removal queues immediate revocation, and provider failure leaves a visible retry state.
A database outbox makes jobs and their originating changes atomic.
Webhook deliveries and billing events have unique idempotency keys.
Assignments are unique per provider PR and expected reviewer and reconcile review requests in both directions.

## Review and billing

The review guide owns ordered hunks spanning files, with hidden files available as supporting changes.
A deterministic grouping can seed the model but is never offered as a free guide.
Guide output must cover each hunk exactly once after normalization.
Accept and flag progress is bound to a head SHA and plan fingerprint.
Geld-billed generation reserves credits atomically before contacting a gateway and settles or refunds once.
Free accounts cannot run guides, including bring-your-own-key guides.
Standard guides cost one credit, guides above 1,500 changed lines cost three, and a replan after a push costs one.
All team members count as seats, and credits are pooled.
Safety-net fallback requires a card, explicit opt-in and a cap, with notification on its first charge.
Stripe remains in test mode until the owner enables live billing.

## Privacy and operations

Raw PR content is processed transiently, never persisted in the application database or audit log.
Generated content uses a storage interface with a customer-database implementation boundary.
Security records are hash chained per team and exclude request bodies, credentials, IPs and user agents.
Optional analytics loads only after measurement consent and uses normalized routes without repository identities.
Feature flags are evaluated independently of analytics consent and all unfinished features default off.
Preview deployments disable authentication even if credentials were accidentally scoped to them.
Self-hosted deployments use the same app with externally configured database, email and gateway services.
Enterprise background work uses direct access only for a registered reachable host, otherwise an authenticated outbound relay.
Interactive work remains in the reader's reachable browser.
