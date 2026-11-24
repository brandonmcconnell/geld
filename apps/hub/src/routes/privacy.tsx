import { createFileRoute, redirect } from "@tanstack/react-router";

// Geld has one privacy policy, on the main site.
export const Route = createFileRoute("/privacy")({
	beforeLoad: () => {
		throw redirect({ href: "https://www.geld.sh/privacy" });
	},
});
