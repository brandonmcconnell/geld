CREATE TABLE repository_apps (
 id text PRIMARY KEY,
 provider text NOT NULL DEFAULT 'github',
 host text NOT NULL DEFAULT 'github.com',
 fingerprint text NOT NULL,
 permissions jsonb NOT NULL,
 app_id text NOT NULL,
 slug text NOT NULL,
 client_id text NOT NULL,
 encrypted_secret text NOT NULL,
 encrypted_private_key text NOT NULL,
 encrypted_webhook_secret text NOT NULL,
 created_by text REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(provider,host,fingerprint)
);
CREATE TABLE app_flows (
 id text PRIMARY KEY,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 team_id text REFERENCES teams(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('manifest','install','authorize')),
 fingerprint text,
 app_id text REFERENCES repository_apps(id) ON DELETE CASCADE,
 state_digest text NOT NULL,
 settings jsonb NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 completed_at timestamptz
);
ALTER TABLE app_installations ADD COLUMN registry_id text REFERENCES repository_apps(id);
ALTER TABLE app_installations ADD COLUMN account_slug text;
ALTER TABLE app_installations ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}';
CREATE TABLE team_app_installations (
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 installation_id text NOT NULL REFERENCES app_installations(id) ON DELETE CASCADE,
 PRIMARY KEY(team_id,installation_id)
);
CREATE TABLE app_user_tokens (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 app_id text NOT NULL REFERENCES repository_apps(id) ON DELETE CASCADE,
 encrypted_access text NOT NULL,
 encrypted_refresh text,
 expires_at timestamptz,
 PRIMARY KEY(user_id,app_id)
);
