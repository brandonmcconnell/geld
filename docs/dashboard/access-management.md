# Teams and provider access

Teams are billable Geld workspaces. Provider organisations remain provider structures. Team membership grants entitlement to see team repositories, intersected with the reader's current provider access. Repository mutations still require the reader's provider permission. Geld team administration does not confer provider administration.

Repository additions require the actor's provider access. Admin approval is on by default. Normal removal sets `removed_at` and preserves settings and ledgers. The visibility setting exposes names, names with requests, a hidden count or nothing. Request approval expires after 14 days. Repository access approval requires provider administration, including when the actor is a Geld admin. Free teams cannot add a second member and Starter teams cannot exceed ten repositories.

Managed access is the parent switch. Sync is nested and starts off. Its preview freshly checks membership against each repository, counts only missing access and makes outside contributors opt-in per repository. Pausing sync keeps existing access. Revocations queue durable jobs and remain pending until confirmed. Existing permissions are recorded as protected baselines with no Geld-owned grant ID. Drift blocks destructive cleanup. Other teams' grants remain part of the revocation calculation. Unaccepted GitHub invitations are deleted through the invitation endpoint.

Each team has one managed provider group **per provider organisation**. A single GitHub team or GitLab subgroup cannot span unrelated provider organisations, so the organisation is part of the unique mapping key. Outside contributors use direct repository access and never an organisation invitation. GitLab uses private subgroups and project sharing. Bitbucket adapters support legacy 1.0 groups, Atlassian Admin groups with a separate customer admin credential, and 2.0 direct users. Migrated workspaces default to direct users until their admin connection is configured. Legacy mode must be explicitly selected for a workspace that has not migrated.

Repository Apps have a canonical permission fingerprint. Existing matching Apps are shared. New fingerprints require the configured Geld owner to confirm GitHub's manifest form once. Keys and OAuth secrets are encrypted. Identity credentials are unaffected. Installation callbacks verify the actual App, permissions and the user's provider administration before recording a team connection. User tokens are selected by the installation's provider account and refreshed through its own App. App JWTs and installation tokens remain behind `TokenSource`.

Security logs use per-team signed hash chains and database append-only triggers. Admins see their own team scope. Business and Enterprise can export paginated JSON. Account export excludes credentials. Retention is 365 days. No IP or user-agent fields are added to the audit records.

References checked November 1, 2026:

- [GitLab group members](https://docs.gitlab.com/api/group_members/)
- [GitLab projects and sharing](https://docs.gitlab.com/api/projects/)
- [Bitbucket 2.0 repository permissions](https://developer.atlassian.com/cloud/bitbucket/new-repo-permission-apis/)
- [Bitbucket legacy groups](https://support.atlassian.com/bitbucket-cloud/docs/groups-endpoint/)
- [Atlassian Admin group creation](https://developer.atlassian.com/cloud/admin/organization/create-group/)

Provider credentials were unavailable during implementation. Fetch fixtures cover endpoint shapes and the no-organisation-invitation guard. Do not report a grant, revocation, installation migration or email delivery as complete merely because it was queued.

## Reader setup and repository selection

GitHub identity sign-in continues into repository App user authorization. This reader flow verifies the user and stores an encrypted App token without requiring organisation installation administration. Installing or migrating a team installation remains an administrator flow with permission and coverage checks. An explicitly configured existing repository App can be imported after its signed App metadata is verified; the identity and repository client IDs must differ. Every repository starts visible. Per-user visibility choices affect the personal queue and sidebar, and loaded selections can be changed later on Connections. Team access is separate from personal visibility.

## Outside collaborators and approvals

The audit lists outside collaborators across loaded provider pages. Include all starts unchecked and is unavailable until every page is loaded. Individuals can be selected separately. A fresh preview verifies the origin collaborator, every target repository's current provider administrator permission, existing access and the grant ledger. Confirmation queues only missing direct invitations. Non-Geld collaborators have a nullable Geld-user reference and do not become team members or provider-organisation members. Already-present permissions and pending grants are preserved. Provider restrictions are surfaced as failed/pending work and are never bypassed.

Repository administrators who are ordinary Geld members can see and decide requests for repositories they administer, with in-product and email notifications. Geld team-admin status alone does not approve repository access.

## Team destruction and concurrent changes

Deletion previews recorded grant and provider-group counts and requires the team name. Personal repositories, and repositories whose ownership kind cannot be established, require an explicit Remove access or Skip choice. The list of skipped access can be downloaded locally. Remove affects Geld-owned grants; repository owners, earlier rights, outside changes and other teams' access are protected. Unknown ownership takes the conservative personal-repository path.

Confirmed deletion pauses sync, blocks other team changes and runs through a durable job. The team and grant ledger remain until provider cleanup, subscription cancellation and generated-content removal succeed. A shared operation lease serializes grants, group creation, destruction and erasure without holding a Postgres connection across network calls. It expires after ten minutes to recover abandoned work. Successful batches do not exhaust failure retries. A revoked provider-group membership reconciles all corresponding ledger rows in that team and organisation. An unavailable provider leaves visible retryable work; it never results in a false success. Account erasure still removes identity credentials and uses its bounded encrypted cleanup path, with a brief retry needed if an access mutation is currently finishing.
