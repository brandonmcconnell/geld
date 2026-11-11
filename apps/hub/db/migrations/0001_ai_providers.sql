-- The reader's AI providers are the dashboard's table, shared like the account
-- tables: its migrations create it first in a shared database, so every
-- statement here is a no-op when it exists. Do not alter it from the hub.
CREATE TABLE IF NOT EXISTS "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"encrypted_key" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relay_channel" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_geld" ON "ai_providers" USING btree ("user_id") WHERE provider = 'geld';
