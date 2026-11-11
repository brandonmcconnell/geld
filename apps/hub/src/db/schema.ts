import {
	bigint,
	boolean,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true });

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull(),
	image: text("image"),
	createdAt: at("created_at").notNull(),
	updatedAt: at("updated_at").notNull(),
});

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: at("expires_at").notNull(),
		token: text("token").notNull().unique(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: at("created_at").notNull(),
		updatedAt: at("updated_at").notNull(),
	},
	(table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: at("access_token_expires_at"),
		refreshTokenExpiresAt: at("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: at("created_at").notNull(),
		updatedAt: at("updated_at").notNull(),
	},
	(table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: at("expires_at").notNull(),
		createdAt: at("created_at"),
		updatedAt: at("updated_at"),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * Orgs that returned an OAuth App access restriction error during a previous
 * search. Used to skip those orgs in the OAuth fallback search source so we
 * stop wasting per-source timeout budget (and stop re-surfacing the same
 * warning on every reload). Entries are removed once the user installs the
 * GitHub App on the org (detected in `getMySearchSources`).
 */
export const userForbiddenOrg = pgTable(
	"user_forbidden_org",
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
	"github_change",
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
		index("github_change_version_idx").on(table.version),
		index("github_change_changed_at_idx").on(table.changedAt),
	],
);
