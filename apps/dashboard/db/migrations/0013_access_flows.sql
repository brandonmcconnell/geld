CREATE TABLE repository_visibility (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('github','gitlab','bitbucket')),
 host text NOT NULL,
 external_id text NOT NULL,
 visible boolean NOT NULL DEFAULT true,
 PRIMARY KEY(user_id,provider,host,external_id)
);
CREATE UNIQUE INDEX grants_external_subject ON grants(team_id,repo_id,provider,provider_user_id) WHERE state<>'revoked' AND provider_user_id IS NOT NULL;
CREATE TABLE "ssoProvider" (
 id text PRIMARY KEY,
 issuer text NOT NULL,
 "oidcConfig" text,
 "samlConfig" text,
 "userId" text REFERENCES users(id) ON DELETE SET NULL,
 "providerId" text NOT NULL UNIQUE,
 "organizationId" text,
 domain text NOT NULL,
 "domainVerified" boolean NOT NULL DEFAULT false
);
CREATE TABLE team_sso_providers (
 provider_id text PRIMARY KEY REFERENCES "ssoProvider"("providerId") ON DELETE CASCADE,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE
);

ALTER TABLE teams ADD COLUMN deleting_at timestamptz;
CREATE TABLE team_operation_leases (
 team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
 holder text NOT NULL,
 expires_at timestamptz NOT NULL
);

ALTER TABLE app_user_tokens ADD COLUMN reader_authorized boolean NOT NULL DEFAULT false;
