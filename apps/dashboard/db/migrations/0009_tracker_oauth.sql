ALTER TABLE tracker_connections ADD COLUMN encrypted_refresh text;
ALTER TABLE tracker_connections ADD COLUMN expires_at timestamptz;
CREATE TABLE tracker_oauth_flows (
 id text PRIMARY KEY,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 provider text NOT NULL,
 state_digest text NOT NULL UNIQUE,
 encrypted_verifier text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 completed_at timestamptz
);
