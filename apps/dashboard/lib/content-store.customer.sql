CREATE TABLE IF NOT EXISTS geld_generated_content (
 id text PRIMARY KEY,
 team_id text NOT NULL,
 repo_id text NOT NULL,
 pull_number integer NOT NULL,
 head_sha text NOT NULL,
 encrypted_content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 UNIQUE(team_id,repo_id,pull_number,head_sha)
);
CREATE TABLE IF NOT EXISTS geld_generated_content_receipts (
 reservation_id text PRIMARY KEY,
 team_id text NOT NULL,
 repo_id text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
