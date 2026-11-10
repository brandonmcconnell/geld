type SiteConfig = {
	name: string;
	domain: string;
	url: string;
	githubRepositoryUrl: string;
	themeColor: string;
	socialImagePath: string;
	defaultTitle: string;
	defaultDescription: string;
	manifestName: string;
	manifestCategories: string[];
};

export const siteConfig: SiteConfig = {
	name: "Geld",
	domain: "app.geld.sh",
	url: "https://app.geld.sh",
	githubRepositoryUrl: "https://github.com/brandonmcconnell/geld",
	themeColor: "#000000",
	socialImagePath: "/logo512.png",
	defaultTitle:
		"Geld | GitHub dashboard for pull requests, issues, and reviews",
	defaultDescription:
		"Geld helps developers track pull requests, issues, and code reviews across GitHub in one fast, focused dashboard.",
	manifestName: "Geld Dashboard",
	manifestCategories: ["developer tools", "productivity"],
};
