import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "#/db";
import { invalidateGitHubInstallationToken } from "#/lib/github.server";
import {
	getGitHubWebhookSecret,
	verifyGitHubWebhookSignature,
} from "#/lib/github-app.server";
import { recordGitHubChanges } from "#/lib/github-change.server";
import { handleGitHubWebhook } from "#/lib/github-webhook.server";
import { guardRoute } from "#/lib/route-safety.server";
import { platform } from "#/platform";
import { PRIVATE_ROUTE_HEADERS } from "#/lib/seo";

const handleWebhook = guardRoute(
	"github-webhook",
	(request: Request) =>
		handleGitHubWebhook(request, {
			getSecret: getGitHubWebhookSecret,
			verifySignature: verifyGitHubWebhookSignature,
			invalidateInstallationToken: invalidateGitHubInstallationToken,
			recordChanges: (rows) => recordGitHubChanges(getDb(), rows),
			runInBackground: platform.runAfterResponse,
		}),
	"webhook_unavailable",
);

export const Route = createFileRoute("/api/webhooks/github")({
	headers: () => PRIVATE_ROUTE_HEADERS,
	server: {
		handlers: {
			POST: ({ request }) => handleWebhook(request),
		},
	},
});
