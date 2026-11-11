import { createFileRoute } from "@tanstack/react-router";
import { TEAM_ROLES, type TeamRole, teamSummary } from "#/lib/teams/teams";
import { getTeams } from "#/lib/teams/teams.functions";

export const Route = createFileRoute("/_protected/settings/teams")({
	loader: async () => getTeams(),
	component: TeamsPage,
});

const ROLE_NAMES: Record<TeamRole, string> = {
	[TEAM_ROLES[0]]: "Admin",
	[TEAM_ROLES[1]]: "Member",
};

function TeamsPage() {
	const { available, teams } = Route.useLoaderData();
	return (
		<section className="flex flex-col gap-4" data-testid="teams">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-semibold">Teams</h2>
				<p className="text-sm text-muted-foreground">
					The teams your Geld account belongs to. A team shares repositories,
					seats and a plan. Teams are created and changed in the Geld
					dashboard for now.
				</p>
			</div>

			<ul className="overflow-hidden rounded-xl border-[0.5px] border-border/70">
				{teams.length === 0 ? (
					<li className="px-4 py-6 text-center text-[13px] text-muted-foreground">
						{available
							? "You are not in a team yet."
							: "This Geld has no teams set up."}
					</li>
				) : null}
				{teams.map((team) => (
					<li
						key={team.id}
						className="flex items-center gap-3 px-4 py-3 not-first:border-t-[0.5px] not-first:border-border/70"
					>
						<div className="min-w-0 flex-1">
							<p className="flex items-center gap-2 text-sm font-medium">
								<span className="truncate">{team.name}</span>
								{team.personal ? (
									<span className="shrink-0 rounded-full border-[0.5px] border-border px-1.5 text-xs font-normal text-muted-foreground">
										Personal
									</span>
								) : null}
							</p>
							<p className="truncate text-xs text-muted-foreground">
								{teamSummary(team)}
							</p>
						</div>
						<span className="shrink-0 text-xs text-muted-foreground">
							{ROLE_NAMES[team.role]}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
