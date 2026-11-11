import { createClientOnlyFn } from "@tanstack/react-start";
import { normalizeAuthRedirect } from "./auth-redirect";
import { buildGitHubAppAuthorizePath } from "./github-access";
import { buildSignInErrorURL } from "./sign-in-error";

/** Mirrors `GITHUB_OAUTH_PROVIDER_ID` on the server. */
const GITHUB_SIGN_IN_PROVIDER = "github-oauth";

export type GitHubSignInMode = "social" | "emulator";

export const signInWithGitHub = createClientOnlyFn(
	async ({
		redirect,
		mode = "social",
	}: {
		redirect?: string;
		mode?: GitHubSignInMode;
	} = {}) => {
		const { clearProtectedRouteCachedAuth } = await import(
			"./protected-auth-cache"
		);
		// Whoever signs in next must not be painted as the previous viewer.
		clearProtectedRouteCachedAuth();

		const callbackURL = normalizeAuthRedirect(redirect);
		const errorCallbackURL = buildSignInErrorURL(callbackURL);
		const { signIn } = await import("./auth.client");
		return signIn.social({
			provider: GITHUB_SIGN_IN_PROVIDER,
			// Demo mode chains straight into the GitHub App authorization so the
			// app-user token exists before the setup gate. The emulator skips its
			// account picker on that second hop.
			callbackURL:
				mode === "emulator"
					? buildGitHubAppAuthorizePath(callbackURL)
					: callbackURL,
			errorCallbackURL,
		});
	},
);

export const signOutToLogin = createClientOnlyFn(async () => {
	const [{ signOut }, { getProtectedRouteCachedAuth }, { clearLocalSession }] =
		await Promise.all([
			import("./auth.client"),
			import("./protected-auth-cache"),
			import("./local-session"),
		]);
	const userId = getProtectedRouteCachedAuth()?.user.id ?? null;
	await signOut();
	await clearLocalSession(userId);
	window.location.href = "/login";
});

/** For someone signed in to Geld another way: adds GitHub to their account. */
export const connectGitHub = createClientOnlyFn(async (returnTo: string) => {
	const { authClient } = await import("./auth.client");
	return authClient.linkSocial({
		provider: GITHUB_SIGN_IN_PROVIDER,
		callbackURL: buildGitHubAppAuthorizePath(returnTo),
		errorCallbackURL: returnTo,
	});
});

/** Adds a provider to the signed-in Geld account and comes back to `returnTo`. */
export const connectProvider = createClientOnlyFn(
	async (identity: string, returnTo: string) => {
		const { authClient } = await import("./auth.client");
		return authClient.linkSocial({
			provider: identity,
			callbackURL: returnTo,
			errorCallbackURL: `${returnTo}?error=connect`,
		});
	},
);
