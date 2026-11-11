import { createServerFn } from "@tanstack/react-start";
import type { TeamList } from "./teams";

export const getTeams = createServerFn({ method: "GET" }).handler(
	async (): Promise<TeamList> => {
		const { getRequestSession } = await import("../auth-runtime");
		const userId = (await getRequestSession())?.user.id;
		if (!userId) return { available: false, teams: [] };
		const { listTeams } = await import("./teams.server");
		return listTeams(userId);
	},
);
