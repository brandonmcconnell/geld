CREATE TABLE enterprise_hosts (
 host text PRIMARY KEY,
 team_id text REFERENCES teams(id) ON DELETE SET NULL,
 relay_channel text,
 encrypted_relay_secret text,
 direct_allowed boolean NOT NULL DEFAULT true,
 created_by text REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enterprise_host_teams (
 host text NOT NULL REFERENCES enterprise_hosts(host) ON DELETE CASCADE,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 PRIMARY KEY(host,team_id)
);
ALTER TABLE subscriptions ADD COLUMN negotiated_overage_cents integer CHECK(negotiated_overage_cents>=0);
ALTER TABLE subscriptions ADD COLUMN contract_verified boolean NOT NULL DEFAULT false;
