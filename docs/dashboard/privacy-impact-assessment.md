# Hosted AI and automatic guide impact assessment

Status: implementation assessment and owner review draft, November 1, 2026. This records the design and remaining decisions. It is not a signed legal assessment or a claim of regulatory approval.

## Processing and roles

Geld processes account, membership, billing and access metadata to deliver the service. Selected PR descriptions, diffs and conversation context pass transiently to the selected AI provider when a user requests a guide or assistant answer. Automatic guides run only under an enabled, inherited policy, with repository AI exclusions respected at execution time. Force pushes trigger a new head check before processing. Raw content is never written to the Geld database, outbox, audit or ordinary application logs. AI-generated summaries and hunk references may still contain personal data or confidential information, so they are encrypted and expire after 30 days.

The hosted service is normally controller for account and service-security processing and may be processor for customer repository content. A customer determines which repositories and users are included. The exact controller/processor allocation, lawful basis and treatment of third-party contributor data require the owner's legal review and customer terms. Account contract does not automatically establish a lawful basis for every person mentioned in a repository.

## Necessity and proportionality

Guides need change context to explain related hunks. The planner limits context, uses excerpts for large changes and identifies excerpted output. The assistant limits history and selected-step context. Metadata needed to check access and billing stays separate from generated content. A local Claude companion delegates authentication to the user's own CLI and cannot access a checkout, shell, MCP servers or persisted sessions. Customer-database mode places encrypted generated content in the selected customer service. Self-hosting allows customers to select their own hosting, database, email, analytics and AI endpoints.

## Risks and controls

| Risk | Implemented controls | Remaining action |
| --- | --- | --- |
| Confidential or personal source content reaches a model provider | Explicit AI feature, repository AI exclusion, configurable provider/key, bounded context, no raw DB storage, encrypted derived output | Confirm provider retention, training restrictions, DPA, subprocessor list and transfer basis |
| Automatic processing runs unexpectedly | Click-only default, inherited overrides and locks, draft/open policy, webhook verification, current-head check and paid entitlement | Customer administrators should communicate processing to affected contributors |
| Prompt injection causes an external action | Repository text treated as untrusted; guide planner has no tools; companion denies tools, MCP and skills in an empty directory | Keep SDK and provider changes under regression review |
| Provider privilege escalation | Effective access intersection, per-user token sources, exact Enterprise host binding, repository-scoped installation tokens, safe revocation baselines | Perform authenticated provider integration checks before hosted launch |
| Cross-team disclosure | Membership and current provider access checks, private-resource visibility options, scoped generated-content keys | Commission independent access-control review |
| Erasure fails during a provider outage | Immediate credential/account removal; encrypted cleanup references with seven-day limit; customer-content retry | Monitor unresolved cleanup and assist with provider-side removal; never retain a deleted user's OAuth token to retry |
| Optional measurement captures source data | c15t consent, GPC refusal, fixed structural schema, normalized routes, no text capture, no replay, no extension analytics | Inspect a staging ingestion sample after configuration |
| Excessive spend or duplicate charges | Credit reservations, idempotency, period-bound refunds, caps, first fallback notice and summaries, test-only Stripe | Owner approves live billing and contract terms separately |
| Incident or unauthorized access | Encryption, scoped sessions, immutable audit chain, minimized identifiers, documented breach process | Test incident contacts, backups, recovery and key rotation |

## Rights, retention and consultation

Product controls provide JSON export, verified email correction, password setup, provider unlink and verified account deletion. The service must answer GDPR requests within one month and applicable California requests within 45 days, documenting lawful extensions. Ordinary repository removal preserves settings; privacy erasure overrides it. Shared-team audit history retains a pseudonymous actor digest for its documented security purpose. Encrypted external cleanup references expire after seven days; anonymous cleanup outcome metadata expires after 30 days. Derived content expires after 30 days, webhook deduplication after 90, write retry keys after 30, and audit/review security records after 365.

Before hosted account launch, the owner should verify privacy@geld.sh, the controller's legal contact/address, processor DPAs and transfer safeguards, applicable EU representative obligations under Article 27, whether residual risk requires supervisory-authority consultation, and the final assessment. A lawyer review is a follow-up. It does not block preparing and testing the implementation with synthetic data. No agreements have been signed and no real customer data has been migrated or deleted during this work.

## Reassessment triggers

Reassess when adding another processor, changing model retention or training terms, enabling new automatic processing, storing a new content category, introducing extension measurement, adding session replay, changing international transfers, or enabling agent tools or external writes.
