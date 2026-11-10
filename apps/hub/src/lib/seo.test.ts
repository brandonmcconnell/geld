import { describe, expect, it } from "vitest";
import { buildSeo, formatPageTitle, summarizeText, toAbsoluteUrl } from "./seo";

describe("summarizeText", () => {
	it("strips basic markdown and whitespace", () => {
		expect(
			summarizeText(
				"# Heading\n\nTrack [pull requests](https://example.com) with `fast` reviews.",
			),
		).toBe("Heading Track pull requests with reviews.");
	});

	it("falls back when the source is empty", () => {
		expect(summarizeText("   ", "Fallback text")).toBe("Fallback text");
	});
});

describe("toAbsoluteUrl", () => {
	it("joins a site url and path", () => {
		expect(toAbsoluteUrl("https://app.geld.sh", "/login")).toBe(
			"https://app.geld.sh/login",
		);
	});
});

describe("buildSeo", () => {
	it("returns canonical links and noindex robots directives", () => {
		const seo = buildSeo({
			siteUrl: "https://app.geld.sh",
			path: "/pulls",
			title: "Pull Requests | Geld",
			description: "Private pull request dashboard.",
			robots: "noindex",
		});

		expect(seo.links).toEqual([
			{ rel: "canonical", href: "https://app.geld.sh/pulls" },
		]);
		expect(seo.meta).toContainEqual({
			name: "robots",
			content: "noindex, nofollow, noarchive",
		});
		expect(seo.meta).toContainEqual({
			property: "og:url",
			content: "https://app.geld.sh/pulls",
		});
	});
});

describe("formatPageTitle", () => {
	it("adds the app name when it is missing", () => {
		expect(formatPageTitle("Fix tab titles")).toBe("Fix tab titles | Geld");
	});

	it("does not duplicate the app name", () => {
		expect(formatPageTitle("Inbox | Geld")).toBe("Inbox | Geld");
	});
});
