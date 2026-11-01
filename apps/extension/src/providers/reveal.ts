import type { ProviderDiffEntry, ProviderDiffView } from './types';

const SELECTION = ['diff_id', 'start_sha', 'commit_id', 'only_context_commits', 'w', 'view', 'from', 'to', 'straight', 'from_project_id'] as const;
const MAX_WAIT_MS = 15_000;
const RETRY_MS = [100, 250, 500, 1000, 2000] as const;
const ALIGN_MS = 1500;
const VIRTUAL_ALIGN_MS = 8000;
const ALIGN_CHECK_MS = 150;

interface PendingReveal {
  readonly path: string;
  readonly visit: string;
  readonly page: string;
  readonly filePath: string | null;
  readonly hashes: Set<string>;
  readonly expires: number;
  readonly clicked: Set<HTMLAnchorElement>;
  readonly expanded: Map<HTMLElement, number>;
  readonly prepared: Set<HTMLElement>;
  navigated: boolean;
  attempts: number;
}

interface Alignment {
  readonly path: string;
  readonly visit: string;
  readonly page: string;
  readonly hash: string;
  readonly expires: number;
  readonly settleDeadline: number;
  settleUntil: number;
  settling: boolean;
  root: HTMLElement;
  lastDrift: number | null;
  repeats: number;
}

function pageUrl(url: URL, withoutFilePath = false): string {
  const copy = new URL(url);
  copy.hash = '';
  if (withoutFilePath) copy.searchParams.delete('file_path');
  copy.searchParams.sort();
  return copy.href;
}

function hashOf(url: URL): string {
  try { return decodeURIComponent(url.hash.slice(1)); } catch { return url.hash.slice(1); }
}

/** Preserve reveal intent while the provider mounts a native file asynchronously. */
export class ProviderReveal {
  private pending: PendingReveal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private alignment: Alignment | null = null;
  private alignTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private observer: ResizeObserver | null = null;
  private listening = false;

  constructor(
    private readonly view: () => ProviderDiffView | null,
    private readonly visit: () => string,
    private readonly doc: Document = document,
  ) {}

  request(path: string): void {
    if (this.stopped || path === '') return;
    this.clear();
    const url = new URL(this.doc.location.href);
    this.pending = { path, visit: this.visit(), page: pageUrl(url, true), filePath: url.searchParams.get('file_path'), hashes: new Set([hashOf(url)]), expires: Date.now() + MAX_WAIT_MS, attempts: 0, clicked: new Set(), expanded: new Map(), prepared: new Set(), navigated: false };
    this.listen();
    this.refresh();
  }

  /** Also called after provider mounting/mutation passes, rather than relying on timers alone. */
  refresh(): void {
    const pending = this.pending;
    if (this.stopped) return;
    if (pending === null) {
      if (this.alignment !== null && !this.validAlignment(this.alignment)) this.clear();
      return;
    }
    if (!this.validPending(pending) || Date.now() >= pending.expires) { this.clear(); return; }
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
        this.finish(view, entry, pending);
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
        pending.hashes.add(hashOf(new URL(link.href, this.doc.location.href)));
        link.click();
      } else if (!pending.navigated && (link === null || link === undefined) && view?.navigateToPath !== undefined) {
        pending.hashes.add('');
        pending.navigated = view.navigateToPath(pending.path);
      }
    }
    this.schedule(pending);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    if (this.alignTimer !== null) clearTimeout(this.alignTimer);
    this.alignTimer = null;
    if (this.frame !== null) this.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.observer?.disconnect();
    this.observer = null;
    this.alignment = null;
    this.unlisten();
  }

  stop(): void { this.stopped = true; this.clear(); }

  private validPending(pending: PendingReveal): boolean {
    const url = new URL(this.doc.location.href);
    const file = url.searchParams.get('file_path');
    return pending.visit === this.visit() && pageUrl(url, true) === pending.page
      && url.searchParams.getAll('file_path').length <= 1 && (file === pending.filePath || file === pending.path) && pending.hashes.has(hashOf(url));
  }

  private validAlignment(alignment: Alignment): boolean {
    const url = new URL(this.doc.location.href);
    return !this.stopped && !this.doc.hidden && alignment.visit === this.visit() && Date.now() < alignment.expires
      && pageUrl(url) === alignment.page && hashOf(url) === alignment.hash;
  }

  private finish(view: ProviderDiffView | null | undefined, entry: ProviderDiffEntry, pending: PendingReveal): void {
    if (!this.validPending(pending)) { this.clear(); return; }
    this.clear();
    const window = this.doc.defaultView;
    if (window === null) return;
    const url = new URL(this.doc.location.href);
    if (entry.anchor !== null && entry.anchor !== '') {
      url.hash = encodeURIComponent(entry.anchor);
      try { window.history.replaceState(window.history.state, '', url.href); } catch { /* A provider navigation may have retired this document. */ }
    }
    if (pending.visit !== this.visit() || pageUrl(new URL(this.doc.location.href), true) !== pending.page) return;
    const now = Date.now();
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.alignment = {
      path: pending.path, visit: pending.visit, page: pageUrl(new URL(this.doc.location.href)), hash: hashOf(new URL(this.doc.location.href)),
      expires: now + (view?.virtualized === true ? VIRTUAL_ALIGN_MS : ALIGN_MS), settleDeadline: now + 800,
      settleUntil: now + (smooth ? 300 : 0), settling: smooth, root: entry.root, lastDrift: null, repeats: 0,
    };
    this.listen();
    if (typeof window.ResizeObserver === 'function') {
      this.observer = new window.ResizeObserver(() => this.queueAlignment());
      this.observer.observe(this.doc.body);
      if (view !== null && view !== undefined && view.container !== this.doc.body) this.observer.observe(view.container);
      this.observer.observe(entry.root);
    }
    entry.root.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'instant' });
    this.scheduleAlignment();
  }

  private scheduleAlignment(): void {
    const alignment = this.alignment;
    if (alignment === null || this.alignTimer !== null) return;
    this.alignTimer = setTimeout(() => { this.alignTimer = null; this.queueAlignment(); }, Math.min(ALIGN_CHECK_MS, Math.max(0, alignment.expires - Date.now())));
  }

  private queueAlignment(): void {
    if (this.alignment === null || this.frame !== null || this.doc.defaultView === null) return;
    this.frame = this.doc.defaultView.requestAnimationFrame(() => { this.frame = null; this.align(); });
  }

  private align(): void {
    const alignment = this.alignment;
    const window = this.doc.defaultView;
    if (alignment === null || window === null) return;
    if (!this.validAlignment(alignment)) { this.clear(); return; }
    if (alignment.settling && Date.now() < alignment.settleUntil) { this.scheduleAlignment(); return; }
    alignment.settling = false;
    const target = this.view()?.entries.find((entry) => entry.path === alignment.path && entry.root.isConnected)?.root;
    if (target === undefined) { this.scheduleAlignment(); return; }
    if (target !== alignment.root) {
      this.observer?.unobserve(alignment.root);
      this.observer?.observe(target);
      alignment.root = target;
      alignment.lastDrift = null;
      alignment.repeats = 0;
    }
    const { drift, scroller } = this.drift(target);
    if (Math.abs(drift) > 4) {
      alignment.repeats = alignment.lastDrift !== null && Math.abs(drift - alignment.lastDrift) < 1 ? alignment.repeats + 1 : 0;
      alignment.lastDrift = drift;
      if (alignment.repeats >= 3) { this.clear(); return; }
      if (scroller === null) window.scrollBy({ top: drift, behavior: 'instant' });
      else scroller.scrollBy({ top: drift, behavior: 'instant' });
    } else { alignment.lastDrift = null; alignment.repeats = 0; }
    this.scheduleAlignment();
  }

  private drift(target: HTMLElement): { readonly drift: number; readonly scroller: HTMLElement | null } {
    const window = this.doc.defaultView;
    if (window === null) return { drift: 0, scroller: null };
    const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
    const top = target.getBoundingClientRect().top;
    let parent = target.parentElement;
    while (parent !== null && parent !== this.doc.scrollingElement && parent !== this.doc.documentElement) {
      const style = window.getComputedStyle(parent);
      if (/^(auto|scroll|overlay)$/.test(style.overflowY || style.overflow) && parent.scrollHeight > parent.clientHeight + 1) {
        const padding = (Number.parseFloat(style.scrollPaddingTop) || 0) * (style.scrollPaddingTop.endsWith('%') ? parent.clientHeight / 100 : 1);
        return { drift: top - parent.getBoundingClientRect().top - parent.clientTop - padding - margin, scroller: parent };
      }
      parent = parent.parentElement;
    }
    return { drift: top - margin, scroller: null };
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const window = this.doc.defaultView;
    const options: AddEventListenerOptions = { capture: true, passive: true };
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown']) window?.addEventListener(event, this.userInput, options);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) window?.addEventListener(event, this.navigation);
    window?.addEventListener('scroll', this.scrolled, options);
    window?.addEventListener('scrollend', this.scrollEnded);
    this.doc.addEventListener('visibilitychange', this.visibility);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    const window = this.doc.defaultView;
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'keydown']) window?.removeEventListener(event, this.userInput, true);
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) window?.removeEventListener(event, this.navigation);
    window?.removeEventListener('scroll', this.scrolled, true);
    window?.removeEventListener('scrollend', this.scrollEnded);
    this.doc.removeEventListener('visibilitychange', this.visibility);
  }

  private readonly userInput = (): void => this.clear();
  private readonly visibility = (): void => { if (this.doc.hidden) this.clear(); };
  private readonly navigation = (): void => {
    if (this.pending !== null ? !this.validPending(this.pending) : this.alignment !== null && !this.validAlignment(this.alignment)) this.clear();
  };
  private readonly scrolled = (): void => {
    const alignment = this.alignment;
    if (alignment?.settling === true) alignment.settleUntil = Math.min(alignment.settleDeadline, Math.max(alignment.settleUntil, Date.now() + 120));
  };
  private readonly scrollEnded = (): void => {
    if (this.alignment === null || !this.alignment.settling) return;
    this.alignment.settling = false;
    this.queueAlignment();
  };

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
