import { env } from "cloudflare:workers";
import type { Queue } from "../types";

function isQueueBinding(value: unknown): value is {
	send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		"send" in value &&
		typeof value.send === "function"
	);
}

/** `name` is the queue's binding: `review-jobs` is bound as `QUEUE_REVIEW_JOBS`. */
export function queue<Message>(name: string): Queue<Message> {
	const bindingName = `QUEUE_${name.replace(/[^a-z0-9]+/giu, "_").toUpperCase()}`;
	return {
		async send(message, options) {
			const binding: unknown = Reflect.get(env, bindingName);
			if (!isQueueBinding(binding)) {
				throw new Error(`Queue binding ${bindingName} is not configured.`);
			}
			await binding.send(message, options);
		},
	};
}
