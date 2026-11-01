CREATE TABLE provider_user_links (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  host text NOT NULL,
  external_id text NOT NULL,
  login text NOT NULL,
  PRIMARY KEY(user_id,provider,host),
  UNIQUE(provider,host,external_id)
);
ALTER TABLE team_repos ADD COLUMN approved boolean NOT NULL DEFAULT true;
ALTER TABLE team_repos ADD COLUMN added_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE grants ADD COLUMN provider_login text;
ALTER TABLE grants ADD COLUMN provider_group_id text;
CREATE UNIQUE INDEX grants_active_user_repo ON grants(team_id,repo_id,user_id) WHERE state <> 'revoked';
CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  kind text NOT NULL,
  resource_id text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_connections (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL,
  host text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  encrypted_credential text,
  PRIMARY KEY(team_id,provider,host)
);
