import { browser } from 'wxt/browser';
import type { AiRunRecord } from './local-state';

export type LocalReviewMutation =
  | { readonly kind: 'ai'; readonly key: string; readonly record: AiRunRecord | null }
  | { readonly kind: 'reviewed'; readonly reviewKey: string; readonly headSha: string; readonly itemId: string; readonly fingerprint: string; readonly reviewed: boolean };

export interface LocalReviewWrite {
  readonly type: 'geld:local-review-write';
  readonly token: string;
  readonly mutation: LocalReviewMutation;
}

interface Transport {
  send(message: LocalReviewWrite): Promise<unknown>;
  subscribe(listener: (message: unknown) => Promise<unknown> | undefined): void;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function createLocalReviewClient(transport: Transport): (mutation: LocalReviewMutation, validate: () => Promise<void>) => Promise<void> {
  const pending = new Map<string, () => Promise<void>>();
  transport.subscribe((message) => {
    if (!record(message) || message.type !== 'geld:local-review-validate' || typeof message.token !== 'string') return undefined;
    const validate = pending.get(message.token);
    return validate === undefined ? undefined : validate().then(() => ({ ok: true }), () => ({ ok: false }));
  });
  return async (mutation, validate) => {
    await validate();
    if (pending.size >= 100) throw new Error('Too many pending local review saves.');
    const token = crypto.randomUUID();
    pending.set(token, validate);
    try {
      const response = await transport.send({ type: 'geld:local-review-write', token, mutation });
      if (!record(response) || response.ok !== true) throw new Error('Review state changed or could not be saved.');
    } finally { pending.delete(token); }
  };
}

let client: ReturnType<typeof createLocalReviewClient> | undefined;
export function writeLocalReview(mutation: LocalReviewMutation, validate: () => Promise<void>): Promise<void> {
  client ??= createLocalReviewClient({
    send: (message) => browser.runtime.sendMessage(message),
    subscribe: (listener) => browser.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
      const response = listener(message);
      if (response === undefined) return undefined;
      void response.then(respond);
      return true;
    }),
  });
  return client(mutation, validate);
}
