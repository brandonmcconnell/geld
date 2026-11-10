import type { QueueData } from './contracts';
import type { QueueInsight } from './queue-insight';
import type { ReviewData } from './review-contracts';

export class MemoryCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();
  constructor(private readonly capacity = 100, private readonly lifetime = 300_000) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    return entry && entry.expires > Date.now() ? entry.value : undefined;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.lifetime });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() { this.entries.clear(); }
}
export interface QueueSnapshot { pages: { cursor: string; data: QueueData }[] }
export function queueData(snapshot: QueueSnapshot): QueueData {
  const pages = snapshot.pages.map(page => page.data);
  const last = pages.at(-1);
  return {
    ...last,
    pulls: [...new Map(pages.flatMap(page => page.pulls).map(pull => [JSON.stringify(pull.ref), pull])).values()],
    repositories: [...new Map(pages.flatMap(page => page.repositories).map(repo => [JSON.stringify(repo.ref), repo])).values()],
  };
}
export function workspaceCache() {
  return {
    queues: new MemoryCache<QueueSnapshot>(30),
    insights: new MemoryCache<QueueInsight>(500),
    reviews: new MemoryCache<ReviewData>(10, 60_000),
  };
}
export type WorkspaceCache = ReturnType<typeof workspaceCache>;

export function updateQueuePages(previous: QueueSnapshot | undefined, pages: QueueSnapshot['pages'], refresh = false): QueueSnapshot {
  return { pages: refresh || !previous ? pages : [
    ...previous.pages.map(page => pages.find(update => update.cursor === page.cursor) ?? page),
    ...pages.filter(page => !previous.pages.some(existing => existing.cursor === page.cursor)),
  ] };
}
