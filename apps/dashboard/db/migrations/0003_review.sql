CREATE UNIQUE INDEX ai_providers_geld ON ai_providers(user_id) WHERE provider = 'geld';
ALTER TABLE credit_reservations ADD COLUMN resource_fingerprint text;
ALTER TABLE credit_reservations ADD COLUMN head_sha text;
CREATE TABLE review_receipts (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL,
  resource_fingerprint text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN settings jsonb NOT NULL DEFAULT '{}';
