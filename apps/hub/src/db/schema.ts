import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Geld's account tables. The dashboard reads and writes the same four, so
 * their names, quoted camelCase columns, defaults and constraints must stay
 * exactly as `apps/dashboard/db/migrations/0001_auth.sql` declares them
 * (`shared-accounts.test.ts` compares the two).
 */
export const user = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique("users_email_key"),
	emailVerified: boolean("emailVerified").notNull().default(false),
	image: text("image"),
	createdAt: at("createdAt").notNull().defaultNow(),
	updatedAt: at("updatedAt").notNull().defaultNow(),
	/** The reader's Geld settings, saved by the dashboard and read by the hub. */
	settings: jsonb("settings").notNull().default({}),
});

export const session = pgTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique("sessions_token_key"),
		expiresAt: at("expiresAt").notNull(),
		createdAt: at("createdAt").notNull().defaultNow(),
		updatedAt: at("updatedAt").notNull().defaultNow(),
		ipAddress: text("ipAddress"),
		userAgent: text("userAgent"),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("sessions_user").on(table.userId)],
);

export const account = pgTable(
	"identities",
	{
		id: text("id").primaryKey(),
		accountId: text("accountId").notNull(),
		providerId: text("providerId").notNull(),
		userId: text("userId")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("accessToken"),
		refreshToken: text("refreshToken"),
		idToken: text("idToken"),
		accessTokenExpiresAt: at("accessTokenExpiresAt"),
		refreshTokenExpiresAt: at("refreshTokenExpiresAt"),
		scope: text("scope"),
		password: text("password"),
		createdAt: at("createdAt").notNull().defaultNow(),
		updatedAt: at("updatedAt").notNull().defaultNow(),
	},
	(table) => [
		unique("identities_providerId_accountId_key").on(
			table.providerId,
			table.accountId,
		),
		index("identities_user").on(table.userId),
	],
);

export const verification = pgTable(
	"verifications",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: at("expiresAt").notNull(),
		createdAt: at("createdAt").notNull().defaultNow(),
		updatedAt: at("updatedAt").notNull().defaultNow(),
	},
	(table) => [index("verifications_identifier").on(table.identifier)],
);

export const rateLimit = pgTable("rateLimit", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique("rateLimit_key_key"),
	count: integer("count").notNull(),
	lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
});

/**
 * Orgs that returned an OAuth App access restriction error during a previous
 * search. Used to skip those orgs in the OAuth fallback search source so we
 * stop wasting per-source timeout budget (and stop re-surfacing the same
 * warning on every reload). Entries are removed once the user installs the
 * GitHub App on the org (detected in `getMySearchSources`).
 */
export const userForbiddenOrg = pgTable(
	"hub_user_forbidden_org",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		org: text("org").notNull(),
		createdAt: at("created_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.org] })],
);

/**
 * Change feed (docs/data-fetching.md, L2): the latest change of each entity a
 * GitHub webhook touched. A repeat change updates the row and raises
 * `version`, which is the cursor clients poll from. The cron sweeper deletes
 * rows unchanged for 15 minutes but always keeps the newest, so `version`
 * never goes backwards.
 */
export const githubChange = pgTable(
	"hub_github_change",
	{
		/** Lowercased `owner/repo`. */
		repo: text("repo").notNull(),
		entityKey: text("entity_key").notNull(),
		isPrivate: boolean("is_private").notNull().default(true),
		version: bigint("version", { mode: "number" }).notNull(),
		/** Epoch milliseconds. */
		changedAt: bigint("changed_at", { mode: "number" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.repo, table.entityKey] }),
		index("hub_github_change_version_idx").on(table.version),
		index("hub_github_change_changed_at_idx").on(table.changedAt),
	],
);
