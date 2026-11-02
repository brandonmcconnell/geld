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
| webhook_deliveries | Delivery identifier, provider and processing outcome | Legitimate interests in reliable security processing | 30 days, no raw event payload |
| outbox_jobs | Typed action references, attempts and retry status | Contract | 30 days after completion, no raw PR payload |
| tracker_connections | Team tracker type, allowed keys, encrypted read-only credential | Contract | Until disconnect or erasure |
| projects, project_repos, roadmap_items | Disabled feature shell metadata only | Contract when enabled | No writes while feature disabled |
| rateLimit | Opaque rate-limit key, count and timestamp | Legitimate interests in abuse prevention | Rolling rate-limit window |
| consent_records | User choice categories and policy version, local first | Consent and evidence of choice | Until superseded or erasure |

No raw diff, PR body, conversation text, assistant prompt or provider API response is stored in these tables.
Generated review content is held on the device or in the customer's selected storage, with explicit retention.
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

Automation additions: `guide_overrides` contains per-PR policy only. `generated_content` contains encrypted AI-produced plans and hunk references for 30 days, never raw diffs, descriptions or comments. In customer-database mode these encrypted records live in the customer's `geld_generated_content` table through the same interface. `mutation_keys` retains structural write idempotency keys for 30 days. Outbox payloads contain only structural IDs, head SHAs and event types. Webhook delivery IDs expire after 90 days. Provider webhook payloads are transient and never persisted.
