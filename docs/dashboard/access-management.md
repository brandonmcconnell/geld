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
