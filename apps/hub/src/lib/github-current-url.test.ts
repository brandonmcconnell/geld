import { describe, expect, it } from "vitest";
import { buildCurrentGitHubUrl } from "./github-current-url";

describe("buildCurrentGitHubUrl", () => {
	it("replaces the production domain with github.com", () => {
		expect(
			buildCurrentGitHubUrl(
				"https://app.geld.sh/brandonmcconnell/geld/pull/42?tab=files#discussion",
			),
		).toBe("https://github.com/brandonmcconnell/geld/pull/42?tab=files#discussion");
	});

	it("replaces local dev origins with github.com over https", () => {
		expect(
			buildCurrentGitHubUrl("http://localhost:3200/brandonmcconnell/geld/issues/7"),
		).toBe("https://github.com/brandonmcconnell/geld/issues/7");
	});
});
