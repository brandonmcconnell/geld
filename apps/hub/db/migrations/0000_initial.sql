-- Geld's account tables (users, sessions, identities, verifications, rateLimit) are
-- shared with the dashboard, whose own migrations create them first in a shared
-- database. They are declared here only for a database the hub has to itself, so
-- every statement on them is a no-op when they already exist. Do not alter them
-- from the hub: change both declarations together.
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_providerId_accountId_key" UNIQUE("providerId","accountId")
);
--> statement-breakpoint
CREATE TABLE "hub_github_change" (
	"repo" text NOT NULL,
	"entity_key" text NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"version" bigint NOT NULL,
	"changed_at" bigint NOT NULL,
	CONSTRAINT "hub_github_change_repo_entity_key_pk" PRIMARY KEY("repo","entity_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	CONSTRAINT "sessions_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "hub_user_forbidden_org" (
	"user_id" text NOT NULL,
	"org" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hub_user_forbidden_org_user_id_org_pk" PRIMARY KEY("user_id","org")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_user_forbidden_org" ADD CONSTRAINT "hub_user_forbidden_org_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identities_user" ON "identities" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "hub_github_change_version_idx" ON "hub_github_change" USING btree ("version");--> statement-breakpoint
CREATE INDEX "hub_github_change_changed_at_idx" ON "hub_github_change" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verifications_identifier" ON "verifications" USING btree ("identifier");