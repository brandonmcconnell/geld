# Assignments, automatic guides and jobs

The review-defaults screen supports team, repository and PR policy scopes. On-click and open PRs are the defaults. An override toggle chooses inherited or local policy, and a parent lock blocks lower edits. Repository default reviewers add to existing review requests and CODEOWNERS. GitHub requests synchronize into assignment records from signed webhooks. Explicit assignments and removals call GitHub's requested-reviewers API first and record success only when confirmed.

GitHub uses per-App webhook secrets and delivery IDs. GitLab uses its shared webhook token and event UUID. Bitbucket uses SHA-256 webhook signatures and request UUIDs. Payloads are processed transiently with a 2 MB limit. Only provider and repository IDs, PR number, head SHA, event kind and reviewer IDs enter durable jobs. Raw descriptions, diffs and comments are discarded. Delivery keys deduplicate repeated hooks.

Automatic jobs re-read policy, draft/open state, repository AI restrictions, the current head, acting account access and plan/cap before generating. Old-head jobs are skipped. GitHub background reads use short-lived installation tokens scoped to the single repository. Other providers use the acting account's Better Auth token source with refresh. Revocations recheck the initiating actor's current provider administration. A disconnected actor leaves the job failed for reconnection, never silently escalates to a service credential.

`GET /api/jobs` requires `Authorization: Bearer CRON_SECRET`. Schedule it on the deployment's scheduler or call it from a private self-hosted worker. It claims two jobs using `SKIP LOCKED`, records attempts, applies capped exponential backoff and recovers abandoned 15-minute locks. Eight failures require intervention. Job results expose counts, not provider bodies or credentials. The runner also expires requests, setup flows, old deliveries and retained content. Stale AI reservations are refunded once after 15 minutes.

Billing jobs use Stripe test mode. Uncertain overage charges older than 23 hours stop for reconciliation rather than risk replay after Stripe's idempotency window. Invitation, access and first fallback emails use idempotent delivery keys and remain failed when email is unconfigured.

Generated AI plans are encrypted through `GeneratedContentStore`, with a 30-day retention default. These are derived summaries and hunk references, not stored raw diff text. `CUSTOMER_CONTENT_DATABASE_URL` selects a separate customer-owned database. Create its `geld_generated_content` table from the standalone schema in the self-hosting guide. Account/team erasure must delete the customer's content through this same interface.

App migration is an explicit second step after the new installation is verified. Geld verifies permission coverage, all old repositories appearing in the replacement and the actor's administration before deleting the old installation. Missing permissions or failed checks retain the old installation. A failed retirement leaves the new installation confirmed and the old record available for retry. Managed grants block a downgrade to an App without access-management permissions.

No live webhook, provider login, mail delivery or Stripe request was available in the implementation environment. Fetch fixtures, signature tests and disposable database tests verify the contracts. Deployment scheduling remains configuration, not a running production service.

## Consolidated findings

The dashboard reuses the shared review clustering, bot registry, source excerpts and AI consolidation contract. Conversation mode shows related findings with every source link. AI rewrites agent-only concerns on an explicit paid request. Human wording is preserved. Generated findings remain in browser memory and are not written to the database. Only fixed structural agent/severity/count/parser-recognition signals can reach consented measurement. An unrecognized shape is a maintenance signal, not evidence that a bot found nothing. Parser fixtures remain the source of truth for format updates; no raw comments are sent as telemetry.

Resolving an item explicitly confirms all its source threads. The server derives thread IDs from fresh provider data rather than trusting client-supplied targets, checks a SHA-256 source revision and the current PR head, and rechecks before each write. Partial success is reported with completed and remaining threads, and a retry requires refreshed state. Item resolution has an idempotency key and structural security receipt. No new AI agent-output standard is defined.

Provider discussion reads paginate GitHub threads and nested replies, GitLab discussions and provider comments, within bounded limits. A bound or cursor failure reports the discussion as unavailable rather than presenting partial data as complete. The user can open the provider for unusually large discussions.
