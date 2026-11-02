ALTER TABLE credit_reservations ADD COLUMN fallback boolean NOT NULL DEFAULT false;
CREATE TABLE erasure_jobs (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('provider_access','content')),
 encrypted_payload text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','manual')),
 attempts integer NOT NULL DEFAULT 0,
 run_after timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX erasure_pending ON erasure_jobs(run_after) WHERE state='pending';

ALTER TABLE teams ADD COLUMN content_erasing_at timestamptz;
