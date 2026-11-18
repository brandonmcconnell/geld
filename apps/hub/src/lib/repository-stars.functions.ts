import { createServerFn } from "@tanstack/react-start";

/** Stars on Geld's own repository; `null` until the first count is cached. */
export const getRepositoryStars = createServerFn({ method: "GET" }).handler(
	async (): Promise<number | null> => {
		const [{ platform }, stars] = await Promise.all([
			import("#/platform"),
			import("./repository-stars.server"),
		]);
		return stars.readRepositoryStars({
			cache: platform.cache(),
			fetchCount: stars.fetchRepositoryStars,
			defer: platform.runAfterResponse,
		});
	},
);
