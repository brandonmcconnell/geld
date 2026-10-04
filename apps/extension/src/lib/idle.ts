/**
 * Work that nobody is waiting on this frame (a network submission, a
 * rewrite of hovercards that may not be open, re-arming a hover tooltip)
 * runs when the browser is idle, with a ceiling so it still happens on a
 * busy page. Keyed: a newer request under the same key replaces the one
 * still waiting, so a burst of passes submits once, with the latest input.
 */

const DEFAULT_TIMEOUT_MS = 500;

interface Pending {
  readonly cancel: () => void;
}

const pending = new Map<string, Pending>();

function requestIdle(run: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => run(), { timeout: timeoutMs });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 1);
  return () => clearTimeout(handle);
}

/** Run `run` when idle (at the latest after `timeoutMs`), replacing any earlier request under `key`. */
export function whenIdle(key: string, run: () => void, timeoutMs = DEFAULT_TIMEOUT_MS): void {
  pending.get(key)?.cancel();
  const cancel = requestIdle(() => {
    pending.delete(key);
    run();
  }, timeoutMs);
  pending.set(key, { cancel });
}

/** Drop a request still waiting under `key`, if any. */
export function cancelIdle(key: string): void {
  pending.get(key)?.cancel();
  pending.delete(key);
}
