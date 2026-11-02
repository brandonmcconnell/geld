CREATE TABLE teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  managed_access boolean NOT NULL DEFAULT false,
  sync_enabled boolean NOT NULL DEFAULT false,
  add_approval boolean NOT NULL DEFAULT true,
  visibility text NOT NULL DEFAULT 'request' CHECK (visibility IN ('names','request','count','none')),
  guide_policy jsonb NOT NULL DEFAULT '{"trigger":"click","drafts":false,"override":true,"locked":false}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT sync_enabled OR managed_access)
);
CREATE TABLE team_members (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id,user_id)
);
CREATE TABLE provider_orgs (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
  host text NOT NULL,
  external_id text NOT NULL,
  slug text NOT NULL,
  UNIQUE (provider,host,external_id)
);
CREATE TABLE team_provider_orgs (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES provider_orgs(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id,org_id)
);
CREATE TABLE team_repos (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
  host text NOT NULL,
  external_id text NOT NULL,
  owner text NOT NULL,
  name text NOT NULL,
  removed_at timestamptz,
  settings jsonb NOT NULL DEFAULT '{}',
  UNIQUE (team_id,provider,host,external_id)
);
CREATE TABLE provider_teams (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES provider_orgs(id),
  provider text NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
  external_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','paused','deleting','deleted','failed')),
  UNIQUE (team_id,provider,org_id)
);
CREATE TABLE assignments (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id text NOT NULL REFERENCES team_repos(id),
  pull_number integer NOT NULL CHECK (pull_number > 0),
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_request_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','requested','completed','removed','failed')),
  UNIQUE (repo_id,pull_number,reviewer_id)
);
CREATE TABLE grants (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id text NOT NULL REFERENCES team_repos(id),
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
  organisation_id text REFERENCES provider_orgs(id),
  provider_user_id text,
  mechanism text NOT NULL CHECK (mechanism IN ('provider_team','collaborator')),
  provider_grant_id text,
  permission text NOT NULL CHECK (permission IN ('read','triage','write','maintain','admin')),
  previous_permission text NOT NULL CHECK (previous_permission IN ('none','read','triage','write','maintain','admin')),
  source text NOT NULL CHECK (source IN ('sync','request_access','audit')),
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','revoking','revoked','drifted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE access_requests (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id text REFERENCES team_repos(id),
  requester_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('repository_access','add_repository')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','denied','expired','withdrawn','granting','failed')),
  approver_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days'
);
CREATE UNIQUE INDEX access_requests_pending ON access_requests(team_id,repo_id,requester_id,kind) WHERE state IN ('pending','granting');
CREATE TABLE audit_events (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','pending','failure')),
  before_state jsonb NOT NULL DEFAULT '{}',
  after_state jsonb NOT NULL DEFAULT '{}',
  request_id text NOT NULL,
  previous_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id,hash)
);
CREATE INDEX audit_events_team_time ON audit_events(team_id,created_at,id);
CREATE TABLE app_installations (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
  host text NOT NULL,
  external_id text NOT NULL,
  app_id text NOT NULL,
  permission_fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','verified','migrating','retired','failed')),
  replaces_id text REFERENCES app_installations(id),
  UNIQUE (provider,host,external_id)
);
CREATE TABLE ai_providers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  base_url text,
  encrypted_key text,
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE subscriptions (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free','starter','team','business','enterprise')),
  status text NOT NULL DEFAULT 'active',
  seats integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  cap_cents integer NOT NULL DEFAULT 0 CHECK (cap_cents >= 0),
  spent_cents integer NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  used_credits integer NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  card_on_file boolean NOT NULL DEFAULT false,
  safety_net boolean NOT NULL DEFAULT false,
  first_fallback_at timestamptz,
  period_start timestamptz NOT NULL DEFAULT date_trunc('month',now()),
  period_end timestamptz NOT NULL DEFAULT date_trunc('month',now()) + interval '1 month'
);
CREATE TABLE credit_reservations (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  credits integer NOT NULL CHECK (credits > 0),
  overage_cents integer NOT NULL DEFAULT 0 CHECK (overage_cents >= 0),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','settled','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id,idempotency_key)
);
CREATE TABLE webhook_deliveries (
  provider text NOT NULL,
  delivery_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pending','processed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider,delivery_id)
);
CREATE TABLE outbox_jobs (
  id text PRIMARY KEY,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  kind text NOT NULL,
  resource_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tracker_connections (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  provider text NOT NULL,
  allowed_keys text[] NOT NULL DEFAULT '{}',
  base_url text,
  encrypted_credential text
);
CREATE TABLE projects (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE TABLE project_repos (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id text NOT NULL REFERENCES team_repos(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id,repo_id)
);
CREATE TABLE roadmap_items (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL
);
CREATE TABLE consent_records (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  measurement boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
