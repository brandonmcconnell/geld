CREATE TABLE relay_channels (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('github','claude')),
 host text NOT NULL,
 encrypted_secret text NOT NULL,
 user_id text REFERENCES users(id) ON DELETE CASCADE,
 enterprise_host text REFERENCES enterprise_hosts(host) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='claude' AND user_id IS NOT NULL AND host='claude.local.geld.invalid' AND enterprise_host IS NULL)
     OR (kind='github' AND enterprise_host=host AND user_id IS NULL))
);
INSERT INTO relay_channels(id,kind,host,encrypted_secret,enterprise_host)
 SELECT relay_channel,'github',host,encrypted_relay_secret,host FROM enterprise_hosts
 WHERE relay_channel IS NOT NULL AND encrypted_relay_secret IS NOT NULL;
ALTER TABLE ai_providers ADD COLUMN relay_channel text REFERENCES relay_channels(id) ON DELETE SET NULL;
UPDATE ai_providers SET provider='claude',settings=settings || '{"mode":"login"}'::jsonb WHERE provider='companion';
CREATE INDEX relay_channels_user ON relay_channels(user_id);
