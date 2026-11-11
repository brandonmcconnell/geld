export const TEAM_ROLES = ["admin", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_TIERS = [
	"free",
	"starter",
	"team",
	"business",
	"enterprise",
] as const;
export type TeamTier = (typeof TEAM_TIERS)[number];

export const TIER_NAMES: Record<TeamTier, string> = {
	free: "Free",
	starter: "Starter",
	team: "Team",
	business: "Business",
	enterprise: "Enterprise",
};

export type TeamView = {
	id: string;
	name: string;
	role: TeamRole;
	/** The workspace every account gets for itself. */
	personal: boolean;
	tier: TeamTier;
	seats: number;
	members: number;
	repositories: number;
};

export type TeamList = {
	/** False where this Geld's database holds no teams at all. */
	available: boolean;
	teams: TeamView[];
};

function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return values.some((candidate) => candidate === value);
}

function count(value: unknown): number {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isFinite(number) && number >= 0
		? Math.trunc(number)
		: 0;
}

/** A team as the database answered it, or null for a row this version cannot read. */
export function teamFromRow(row: Record<string, unknown>): TeamView | null {
	const { id, name, role, tier } = row;
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		!isOneOf(TEAM_ROLES, role)
	) {
		return null;
	}
	return {
		id,
		name,
		role,
		personal: row.personal === true,
		tier: isOneOf(TEAM_TIERS, tier) ? tier : "free",
		seats: Math.max(count(row.seats), 1),
		members: count(row.members),
		repositories: count(row.repositories),
	};
}

function plural(amount: number, one: string, many: string): string {
	return `${amount} ${amount === 1 ? one : many}`;
}

export function teamSummary(team: TeamView): string {
	return [
		TIER_NAMES[team.tier],
		team.personal
			? "Only you"
			: `${plural(team.members, "member", "members")} of ${plural(team.seats, "seat", "seats")}`,
		plural(team.repositories, "repository", "repositories"),
	].join(" · ");
}
