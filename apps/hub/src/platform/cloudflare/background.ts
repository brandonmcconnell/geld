import { waitUntil } from "cloudflare:workers";
import type { RunAfterResponse } from "../types";

export const runAfterResponse: RunAfterResponse = (work) => {
	const settled = work.catch((error: unknown) => {
		console.warn("[background] task failed", error);
	});
	try {
		waitUntil(settled);
	} catch {
		// No request to outlive (a test, a script): the work still runs.
	}
};
