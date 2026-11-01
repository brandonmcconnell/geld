import type { ProviderDiffView } from './types';

const SELECTION = ['diff_id', 'start_sha', 'commit_id', 'only_context_commits', 'w', 'view', 'from', 'to', 'straight', 'from_project_id'] as const;
const MAX_WAIT_MS = 15_000;
const RETRY_MS = [100, 250, 500, 1000, 2000] as const;

interface PendingReveal {
  readonly path: string;
  readonly visit: string;
  readonly expires: number;
  readonly clicked: Set<HTMLAnchorElement>;
  readonly expanded: Map<HTMLElement, number>;
  readonly prepared: Set<HTMLElement>;
  navigated: boolean;
  attempts: number;
}

/** Preserve reveal intent while the provider mounts a native file asynchronously. */
export class ProviderReveal {
  private pending: PendingReveal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly view: () => ProviderDiffView | null,
    private readonly visit: () => string,
    private readonly doc: Document = document,
  ) {}

  request(path: string): void {
    if (this.stopped || path === '') return;
    this.clear();
    this.pending = { path, visit: this.visit(), expires: Date.now() + MAX_WAIT_MS, attempts: 0, clicked: new Set(), expanded: new Map(), prepared: new Set(), navigated: false };
    this.refresh();
  }

  /** Also called after provider mounting/mutation passes, rather than relying on timers alone. */
  refresh(): void {
    const pending = this.pending;
    if (pending === null || this.stopped) return;
    if (pending.visit !== this.visit() || Date.now() >= pending.expires) { this.clear(); return; }
    if (this.doc.hidden) { this.schedule(pending); return; }
    const view = this.view();
    const entry = view?.entries.find((item) => item.path === pending.path && item.root.isConnected);
    if (entry !== undefined) {
      // Rapid Diffs can connect its root before streaming native controls. Wait for those controls.
      const expanded = entry.isExpanded?.();
      const last = pending.expanded.get(entry.root);
      const accepted = expanded === true || ((last === undefined || Date.now() - last >= 1000) && entry.expand());
      if (accepted && expanded !== true) pending.expanded.set(entry.root, Date.now());
      if (accepted && entry.isExpanded?.() !== false) {
        this.clear();
        entry.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (!pending.prepared.has(entry.root) && entry.prepareReveal !== undefined) {
        pending.prepared.add(entry.root);
        entry.prepareReveal();
      }
    } else {
      const link = view?.tree.find((item) => item.path === pending.path)?.link;
      if (link !== null && link !== undefined && link.isConnected && !pending.clicked.has(link) && this.sameSelection(link, pending.path)) {
        pending.clicked.add(link);
        link.click();
      } else if (!pending.navigated && (link === null || link === undefined) && view?.navigateToPath !== undefined) {
        pending.navigated = view.navigateToPath(pending.path);
      }
    }
    this.schedule(pending);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  stop(): void { this.stopped = true; this.clear(); }

  private schedule(pending: PendingReveal): void {
    if (this.pending !== pending || this.timer !== null) return;
    const delay = RETRY_MS[Math.min(pending.attempts, RETRY_MS.length - 1)] ?? 2000;
    pending.attempts += 1;
    this.timer = setTimeout(() => { this.timer = null; this.refresh(); }, Math.min(delay, Math.max(0, pending.expires - Date.now())));
  }

  private sameSelection(link: HTMLAnchorElement, path: string): boolean {
    try {
      const current = new URL(this.doc.location.href);
      const target = new URL(link.href, current);
      if (target.origin !== current.origin || target.username !== '' || target.password !== '' || target.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')) return false;
      if (current.hostname === 'bitbucket.org') return target.search === current.search && decodeURIComponent(target.hash.slice(1)) === `chg-${path}`;
      if (target.searchParams.get('file_path') !== path) return false;
      return SELECTION.every((name) => target.searchParams.get(name) === current.searchParams.get(name));
    } catch { return false; }
  }
}
