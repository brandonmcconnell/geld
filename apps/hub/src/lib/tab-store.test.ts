// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { readStoredTabs, TABS_STORAGE_KEY, type Tab } from "./tab-store";

describe("readStoredTabs", () => {
	afterEach(() => {
		localStorage.clear();
	});

	it("keeps persisted repo tabs", () => {
		const storedTabs: Tab[] = [
			{
				id: "repo:geld/app",
				type: "repo",
				title: "geld/app",
				url: "/geld/app",
				repo: "geld/app",
				iconColor: "text-muted-foreground",
				avatarUrl: "https://example.com/avatar.png",
			},
		];

		localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(storedTabs));

		expect(readStoredTabs()).toEqual(storedTabs);
	});

	it("keeps persisted commits and releases tabs", () => {
		const storedTabs: Tab[] = [
			{
				id: "commits:geld/app",
				type: "commits",
				title: "Commits · geld/app",
				url: "/geld/app/commits",
				repo: "geld/app",
				iconColor: "text-muted-foreground",
			},
			{
				id: "releases:geld/app",
				type: "releases",
				title: "Releases · geld/app",
				url: "/geld/app/releases",
				repo: "geld/app",
				iconColor: "text-muted-foreground",
			},
		];

		localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(storedTabs));

		expect(readStoredTabs()).toEqual(storedTabs);
	});

	it("clears storage when a tab type is unsupported", () => {
		localStorage.setItem(
			TABS_STORAGE_KEY,
			JSON.stringify([
				{
					id: "project:geld/app",
					type: "project",
				},
			]),
		);

		expect(readStoredTabs()).toEqual([]);
		expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
	});
});
