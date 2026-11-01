ALTER TABLE outbox_jobs ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
CREATE TABLE guide_overrides (
 repo_id text NOT NULL REFERENCES team_repos(id) ON DELETE CASCADE,
 pull_number integer NOT NULL CHECK(pull_number>0),
 policy jsonb NOT NULL,
 PRIMARY KEY(repo_id,pull_number)
);
CREATE TABLE generated_content (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 repo_id text NOT NULL REFERENCES team_repos(id) ON DELETE CASCADE,
 pull_number integer NOT NULL,
 head_sha text NOT NULL,
 encrypted_content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 UNIQUE(team_id,repo_id,pull_number,head_sha)
);
CREATE TABLE mutation_keys (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key text NOT NULL,
 state text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,key)
);
