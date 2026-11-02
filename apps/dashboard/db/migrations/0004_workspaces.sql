ALTER TABLE teams ADD COLUMN personal_owner_id text UNIQUE REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE subscriptions ADD COLUMN stripe_event_created bigint NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN stripe_item_id text;
ALTER TABLE subscriptions ADD COLUMN pending_tier text;
ALTER TABLE subscriptions ADD COLUMN included_credits integer NOT NULL DEFAULT 0;
ALTER TABLE credit_reservations ADD COLUMN period_start timestamptz;
ALTER TABLE credit_reservations ADD COLUMN billing_subscription_id text;
ALTER TABLE credit_reservations ADD COLUMN settled_at timestamptz;
UPDATE credit_reservations r SET period_start=s.period_start,billing_subscription_id=s.stripe_subscription_id
FROM subscriptions s WHERE r.team_id=s.team_id AND r.state='reserved' AND r.created_at>=s.period_start AND r.created_at<s.period_end;
UPDATE credit_reservations SET settled_at=created_at WHERE state='settled';
ALTER TABLE audit_events ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE audit_events ADD COLUMN actor_digest text NOT NULL DEFAULT '';
CREATE TABLE billing_events (
  id text PRIMARY KEY,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'processed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_invites (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by text REFERENCES users(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','declined','expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  UNIQUE (team_id,invited_user_id)
);
CREATE FUNCTION geld_protect_audit_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Audit events are append only';
  END IF;
  IF OLD.created_at < now() - interval '365 days' OR NOT EXISTS(SELECT 1 FROM teams WHERE id = OLD.team_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Audit events are append only';
END;
$$;
CREATE TRIGGER geld_audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION geld_protect_audit_events();
CREATE TABLE billing_checkouts (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  tier text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  request_key text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  encrypted_request text,
  subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_checkouts_one_pending ON billing_checkouts(team_id) WHERE state IN ('creating','pending');
