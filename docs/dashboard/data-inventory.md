# Data inventory and processing record

Controller: Brandon McConnell, operator of Geld.
The privacy contact and processor agreements must be verified before hosted account launch.
The extension's unauthenticated features do not require a Geld account.
Data subjects are account holders, team members and provider collaborators referenced by access requests or grants.

| Tables | Personal data and purpose | Lawful basis | Retention and erasure |
| --- | --- | --- | --- |
| users | Name, email, verification, avatar and account settings | Contract | Active account, immediate account erasure |
| sessions | Session identifiers, expiry and user reference | Contract | Session expiry or sign-out, immediate erasure |
| identities | Linked provider identity, encrypted OAuth tokens and password hash | Contract | Until unlink or erasure |
| verifications | Hashed OTP, magic link or reset verification | Contract | Expiry or use |
| teams, team_members | Team name, membership and administrative role | Contract | Membership or team lifetime, immediate personal erasure |
| provider_orgs, team_provider_orgs | Provider host and external organisation references | Contract | Active team association |
| team_repos | Repository references, visibility, removal timestamp and settings | Contract | Retain normal removals, erase on privacy deletion |
| provider_teams | Geld-managed group mapping and sync state | Contract | Until mapping is removed and grants reconciled |
| assignments | PR number, expected reviewer and provider request reference | Contract | Until removed or erasure |
| grants | Actor, recipient, original permission, mechanism and revocation state | Contract and legitimate interests in safe access control | Team lifetime, erase personal fields on erasure |
| access_requests | Requester, target, approver and outcome | Contract | Pending requests expire after 14 days, erase on request |
| audit_events | Actor reference, action, scoped resource reference, safe before/after and chain digest | Legitimate interests in security | 365 days, erase identifying references on erasure |
| app_installations | Host, App permission fingerprint, installation ID and migration state | Contract | Installation lifetime, never private keys |
| ai_providers | Owner, provider instance, encrypted key and model preferences | Contract | Until removal or erasure |
| billing_events, billing_checkouts | Verified event and checkout references for idempotency and plan changes | Contract | Billing dispute window, no payment details |
| team_invites | Existing Geld user, inviting actor and expiry | Contract | Expiry after 14 days or account erasure |
| subscriptions | Stripe customer/subscription references, tier, seats and spend cap | Contract | Active contract plus statutory billing obligations |
| review_receipts | Actor, keyed resource fingerprint, review action and outcome, no review body | Legitimate interests in security | 365 days, erase identifying references on erasure |
| credit_reservations | Idempotency key, credit amount, state and settlement | Contract | Billing period plus dispute window, no PR content |
| webhook_deliveries | Delivery identifier, provider and processing outcome | Legitimate interests in reliable security processing | 90 days, no raw event payload |
| outbox_jobs | Typed action references, attempts and retry status | Contract | 30 days after completion, no raw PR payload |
| tracker_connections | Team tracker type, allowed keys, encrypted read-only credential | Contract | Until disconnect or erasure |
| projects, project_repos, roadmap_items | Disabled feature shell metadata only | Contract when enabled | No writes while feature disabled |
| rateLimit | Opaque rate-limit key, count and timestamp | Legitimate interests in abuse prevention | Rolling rate-limit window |
| consent_records | User choice categories and policy version, local first | Consent and evidence of choice | Until superseded or erasure |

No raw diff, PR body, conversation text, assistant prompt or provider API response is stored in these tables.
Generated review content is held on the device or encrypted in the configured hosted/customer content store with a 30-day retention.
Audit before/after fields accept only an allowlisted structural schema.
Passwords are hashed by Better Auth and OAuth tokens are encrypted at rest.
Secrets live in deployment secret stores or ignored local files.

Processors are Vercel for hosting, Neon for Postgres, the configured transactional email service, Stripe for billing, PostHog for consented measurement, the configured AI gateway and model providers, and connected trackers for read-only status.
Self-hosted customers select their own equivalents.
Each processor needs an appropriate DPA and international transfer safeguards where required.
A hosted AI impact assessment and an EU representative assessment are owner launch follow-ups.

Rights include JSON export, email correction, password setup, provider unlinking and account deletion.
Privacy requests are acknowledged and handled within one month under GDPR or 45 days where CCPA applies.
The product is not intended for children under 16.
Account erasure overrides ordinary repository-removal retention.
Security incident procedures include assessment and regulator notification within 72 hours where required.

Access and App setup additions: `provider_user_links` maps a linked identity to its provider ID and username for assignments and grants. `notifications` stores structural in-product notices. `provider_connections` holds encrypted customer service credentials and selected Bitbucket adapter settings. `repository_apps` stores canonical permission sets and encrypted App credentials. `app_flows` holds single-use hashed setup state for 15 minutes. `team_app_installations` maps verified installations to teams. `app_user_tokens` holds encrypted repository App OAuth credentials, separate from identity sign-in. All user-owned rows cascade on erasure. No raw PR content is stored in these tables.

Automation additions: `guide_overrides` contains per-PR policy only. `generated_content` contains encrypted AI-produced plans and hunk references for 30 days, never raw diffs, descriptions or comments. In customer-database mode these encrypted records live in the customer's `geld_generated_content` table through the same interface. `mutation_keys` retains structural write idempotency keys for 30 days. Ordinary outbox payloads contain structural IDs, head SHAs and event types. Financial cleanup jobs retain encrypted checkout/subscription references independently of an erased account until cancellation or expiration is confirmed, then clear the payload. Webhook delivery IDs expire after 90 days. Provider webhook payloads are transient and never persisted.

Tracker settings hold a provider, an allowed key/scope list and one encrypted read-only team credential. Tracker status is fetched transiently and never persisted as ticket content. Extension dashboard access is an optional host permission requested by a direct user action. It stores only a public account view, team choice and tracker link configuration locally. Provider and tracker credentials remain server-side. Website and extension session checks use the same Better Auth cookie. Firefox declares optional authentication information, identifying information and website content for these opted-in features. No extension analytics is introduced by this tracker change.

`tracker_oauth_flows` stores hashed single-use state, an encrypted PKCE verifier and team/actor references for 15 minutes. Tracker connections hold encrypted refresh tokens and expiry metadata where the provider supports them. Setup flows are purged after expiration. No authorization code, plaintext token or ticket text is stored in the ledger or logs.

`enterprise_hosts` holds registered hostname, public-reachability policy and an encrypted connector secret. `enterprise_host_teams` scopes each host to teams. Relay request and response bodies remain in process memory for active calls only and are never written to a database or log. Browser reader tokens are read-only and repository-scoped, delivered with `private, no-store` and kept only in a request closure. `contract_verified` and negotiated Enterprise pool/rate values are operator-controlled subscription metadata.

Companion additions: `relay_channels` stores a host/kind, encrypted Geld relay secret and owning user or Enterprise host. These are not Claude credentials. Account deletion cascades user channels, provider removal revokes them, and re-pairing revokes the prior channel. The local companion stores only the Geld pairing in a mode-0600 file. Anthropic's own CLI handles sign-in. Prompts and completions pass through the signed relay in memory, with a 90-second local generation deadline and no persisted CLI session. The broker reads encrypted channel records with a deployment-scoped database credential.

Erasure additions: `erasure_jobs` holds only encrypted references needed to revoke Geld-owned grants or remove generated content from temporarily unavailable customer storage. It has no foreign key to the erased account and stores no OAuth credentials, email, raw PR content or name. Payloads are removed on completion or after seven days. Anonymous job outcomes expire after 30 days. The deleted user's direct identifiers are scrubbed from retained shared-team grant records; security actor digests remain pseudonymous and subject to the 365-day security purpose. Normal provider outages cannot block account erasure.

Consented dashboard measurement accepts fixed event names, fixed selector tokens and bounded structural counts. It never accepts arbitrary text, URLs, credentials, file paths, usernames, account/team/repository identifiers or SDK automatic page/device properties. The public project token, event UUID/timestamp and a fresh random in-memory anonymous ID are retained only as required by the ingestion protocol; no profile is created. Selector heat maps use a 4-by-4 cell inside known controls. Routes normalize resource segments. Provider setup, navigation, repeated-click signals, form abandonment, feature use and checkout starts are optional. Session replay and autocapture remain off. Release flags evaluate a global identity on the server or an operator snapshot, emit no flag-called events, and are independent of measurement choice. Projects and roadmaps default off; initiatives remain deferred.

Access-flow additions: `repository_visibility` holds each user's provider/host/repository-ID display choice. It defaults to visible and cascades on account erasure. `team_operation_leases` holds only a team ID, random holder and ten-minute expiry to serialize provider access changes with erasure and destruction. Outside grants can reference a verified provider identity without a Geld account, with a unique active subject/repository constraint. Such grants do not create a Geld seat or an organisation membership.

`"ssoProvider"` stores the issuer, verified email domain, creator and an encrypted OIDC/SAML configuration. Only OIDC is exposed. `team_sso_providers` scopes it to a Business/Enterprise team. Domain DNS proof tokens are temporary public verification values, not hashed sign-in secrets. SSO credentials belong to the team connection and are removed with that connection or personal-workspace erasure. Team-owned SSO configuration can outlive its creator in a shared team, requiring another admin's ownership handover. ID tokens now use an encrypted adapter field in addition to Better Auth's encrypted OAuth access/refresh tokens.

A minimal encrypted Stripe subscription reference may survive account erasure in an unlinked cancellation job solely to stop recurring billing. It contains no email, user ID or provider credential. Its payload is cleared on confirmed cancellation and completed job metadata expires after 30 days. Unresolved cancellation is retained for financial reconciliation, unlike the seven-day provider/content cleanup payload. Team destruction waits for cancellation confirmation. Seat jobs recalculate actual current membership instead of trusting a stale stored count.
