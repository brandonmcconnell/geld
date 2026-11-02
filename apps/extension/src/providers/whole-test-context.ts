import type { GeldSettings, TestFold } from '@geld/core';
import { providerOutlineContext } from './source-facts';
import type { ProviderNewFileRevision, ProviderOutlineContext } from './source-facts';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffLine, ProviderDiffResult, ProviderDiffView, ProviderPage } from './types';
import { ProviderWholeSourceCache } from './whole-source';
import type { ProviderWholeSourceLease, ProviderWholeSourceReader, ProviderWholeSourceValue } from './whole-source';

export interface ProviderNativeContextStep { current(): boolean; activate(): void }
export interface ProviderWholeTestAdapter {
  readonly readSource: ProviderWholeSourceReader;
  createIntent(doc: Document): { readonly button: HTMLButtonElement; readonly text: HTMLElement };
  intentHost(entry: ProviderDiffEntry): HTMLElement | null;
  contextOmitted(entry: ProviderDiffEntry): boolean;
  nextContext(entry: ProviderDiffEntry, missing: readonly number[]): ProviderNativeContextStep | null;
  paused(origin: string): boolean;
}
export interface ProviderWholeTestSession {
  mount(entry: ProviderDiffEntry): void;
  source(entry: ProviderDiffEntry): ProviderWholeSourceValue | null;
  reveal(entry: ProviderDiffEntry, fold: TestFold, open: () => boolean): void;
  cancelReveal(entry: ProviderDiffEntry): void;
  retain(roots: ReadonlySet<HTMLElement>): void;
}
interface Current { readonly result: ProviderDiffResult; readonly view: ProviderDiffView; readonly context: ProviderOutlineContext; readonly settings: GeldSettings }
interface FileIntent {
  readonly root: HTMLElement; readonly path: string; readonly key: string; readonly subject: string;
  readonly host: HTMLElement; readonly button: HTMLButtonElement; readonly text: HTMLElement;
  status: 'idle' | 'loading' | 'ready' | 'failed'; abort: AbortController | null; reveal: AbortController | null;
}

export function providerWholeSourceAgrees(lines: readonly string[], shown: readonly ProviderDiffLine[]): boolean {
  const seen = new Map<number, string>();let count = 0;
  for (const line of shown) {
    if (line.kind === 'hunk' || line.newLine === null) continue;
    if (!Number.isSafeInteger(line.newLine) || line.newLine < 1 || line.newText === null || lines[line.newLine - 1] !== line.newText) return false;
    const previous = seen.get(line.newLine);if (previous !== undefined && previous !== line.newText) return false;
    seen.set(line.newLine, line.newText);count++;
  }
  return count > 0;
}
export function providerMissingNewLines(fold: TestFold, shown: readonly ProviderDiffLine[]): readonly number[] {
  const present = new Set(shown.flatMap((line) => line.newLine === null ? [] : [line.newLine]));
  return [...new Set([...fold.headingKeys, ...fold.bodyKeys].filter((key) => /^R[1-9]\d*$/.test(key)).map((key) => Number(key.slice(1))))].filter((number) => !present.has(number)).sort((a, b) => a - b);
}

export class ProviderWholeTestContext implements ProviderWholeTestSession {
  private readonly cache: ProviderWholeSourceCache;
  private readonly files = new Map<HTMLElement, FileIntent>();
  private readonly attempted = new Set<string>();
  private latest: Current | null = null;
  private generation = 0;
  constructor(private readonly adapter: ProviderAdapter, private readonly feature: ProviderWholeTestAdapter, private readonly refresh: () => void, private readonly doc: Document = document) { this.cache = new ProviderWholeSourceCache(feature.readSource); }

  update(page: ProviderPage, result: ProviderDiffResult, view: ProviderDiffView, settings: GeldSettings, context: ProviderOutlineContext): void {
    if (this.latest?.context.subjectKey !== context.subjectKey) { this.retire();this.attempted.clear(); }
    this.latest = { result, view, settings, context };
    void page;
  }

  mount(entry: ProviderDiffEntry): void {
    const latest = this.latest;const revision = latest?.context.newSources.get(entry.root);const host = this.feature.intentHost(entry);
    if (!latest?.settings.enabled || !latest.settings.testOutline || revision === undefined || host === null || latest.view.filteredPaths.has(entry.path) || !this.feature.contextOmitted(entry)) { this.remove(entry.root);return; }
    let intent = this.files.get(entry.root);
    if (intent !== undefined && (intent.key !== revision.key || intent.subject !== latest.context.subjectKey || intent.host !== host || intent.button.parentElement !== host)) { this.remove(entry.root);intent = undefined; }
    if (intent === undefined) {
      const { button, text } = this.feature.createIntent(this.doc);button.type = 'button';button.classList.add('geld-provider-test-boundaries');button.setAttribute('data-geld-ui', '');button.setAttribute('data-geld-test-boundaries', '');
      intent = { text, root: entry.root, path: entry.path, key: revision.key, subject: latest.context.subjectKey, host, button, status: this.attempted.has(revision.key) || this.attempted.size >= 16 ? 'failed' : 'idle', abort: null, reveal: null };
      const owned = intent;
      button.addEventListener('click', (event) => { event.preventDefault();event.stopPropagation();if (!event.isTrusted || this.files.get(entry.root) !== owned) return;void this.request(owned); });
      this.files.set(entry.root, intent);host.append(button);
    }
    this.label(intent);
  }

  source(entry: ProviderDiffEntry): ProviderWholeSourceValue | null {
    const intent = this.files.get(entry.root);
    if (intent?.status !== 'ready' || this.latest?.context.subjectKey !== intent.subject || this.latest.context.newSources.get(entry.root)?.key !== intent.key) return null;
    const body = this.cache.ready(intent.key);
    if (body === null || !providerWholeSourceAgrees(body.lines, entry.readLines?.() ?? [])) { intent.status = 'failed';intent.reveal?.abort();this.label(intent);return null; }
    return body;
  }

  cancelReveal(entry: ProviderDiffEntry): void { this.files.get(entry.root)?.reveal?.abort(); }

  reveal(entry: ProviderDiffEntry, fold: TestFold, open: () => boolean): void {
    const intent = this.files.get(entry.root);if (intent === undefined || this.source(entry) === null) return;
    for (const other of this.files.values()) other.reveal?.abort();
    const abort = new AbortController();intent.reveal = abort;
    const cancel = (event: Event): void => { if (event.isTrusted) abort.abort(); };
    this.doc.addEventListener('pointerdown', cancel, true);this.doc.addEventListener('keydown', cancel, true);
    void this.revealLoop(intent, fold, open, abort.signal).finally(() => {
      this.doc.removeEventListener('pointerdown', cancel, true);this.doc.removeEventListener('keydown', cancel, true);
      if (intent.reveal === abort) intent.reveal = null;
    });
  }

  retain(roots: ReadonlySet<HTMLElement>): void {
    for (const [root, intent] of this.files) {
      if (!roots.has(root)) { this.remove(root);continue; }
      if ((intent.abort !== null || intent.reveal !== null) && this.lease(intent) === null) { intent.abort?.abort();intent.reveal?.abort(); }
    }
  }

  retire(): void { this.generation++;for (const root of [...this.files.keys()]) this.remove(root);this.latest = null; }
  destroy(): void { this.retire();this.cache.destroy(); }

  private remove(root: HTMLElement): void { const intent = this.files.get(root);if (intent === undefined) return;intent.abort?.abort();intent.reveal?.abort();intent.button.remove();this.files.delete(root); }
  private label(intent: FileIntent): void {
    intent.text.textContent = intent.status === 'idle' ? 'Find test boundaries' : intent.status === 'loading' ? 'Finding test boundaries…' : intent.status === 'ready' ? 'Test boundaries found' : 'Test boundaries unavailable';
    intent.button.disabled = intent.status !== 'idle';intent.button.dataset.status = intent.status;
  }

  private lease(intent: FileIntent): { lease: ProviderWholeSourceLease; entry: ProviderDiffEntry } | null {
    const generation = this.generation;
    const read = (): { revision: ProviderNewFileRevision; entry: ProviderDiffEntry } | null => {
      try {
        const latest = this.latest;
        if (this.doc.defaultView === null || this.doc.hidden || generation !== this.generation || this.files.get(intent.root) !== intent || !latest?.settings.enabled || !latest.settings.testOutline || latest.context.subjectKey !== intent.subject || !intent.root.isConnected) return null;
        const page = this.adapter.describe(new URL(this.doc.URL), this.doc);const view = this.adapter.readDiff(this.doc);
        const entry = view?.entries.find((file) => file.root === intent.root && file.path === intent.path);
        if (page === null || view === null || entry === undefined || view.filteredPaths.has(intent.path) || entry.isExpanded?.() !== true || intent.root.closest('[hidden], [inert], [aria-hidden="true"], [data-geld-provider-hidden="closed"]') !== null || this.doc.defaultView?.getComputedStyle(intent.root).display === 'none') return null;
        const fresh = providerOutlineContext(page, latest.result, view);const revision = fresh.newSources.get(intent.root);
        return fresh.subjectKey === intent.subject && revision?.key === intent.key ? { revision, entry } : null;
      } catch { return null; }
    };
    const value = read();
    return value === null ? null : { entry: value.entry, lease: { revision: value.revision, root: intent.root, subjectKey: intent.subject, current: () => read() !== null } };
  }

  private async request(intent: FileIntent): Promise<void> {
    if (intent.status !== 'idle' || this.attempted.has(intent.key) || this.attempted.size >= 16) return;
    const bound = this.lease(intent);if (bound === null || this.feature.paused(bound.lease.revision.repository.origin)) return;
    this.attempted.add(intent.key);const abort = new AbortController();intent.abort = abort;intent.status = 'loading';this.label(intent);
    try {
      const body = await this.cache.load(bound.lease, abort.signal);
      const fresh = this.lease(intent);if (abort.signal.aborted || fresh === null) { intent.status = 'failed';return; }
      intent.status = providerWholeSourceAgrees(body.lines, fresh.entry.readLines?.() ?? []) ? 'ready' : 'failed';
    } catch { if (this.files.get(intent.root) === intent) intent.status = 'failed'; }
    finally { if (intent.abort === abort) intent.abort = null;if (this.files.get(intent.root) === intent) { this.label(intent);this.refresh(); } }
  }

  private async revealLoop(intent: FileIntent, fold: TestFold, open: () => boolean, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 30_000;
    try {
      for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        if (signal.aborted || !open()) return;
        const bound = this.lease(intent);if (bound === null || this.feature.paused(bound.lease.revision.repository.origin)) return;
        const body = this.source(bound.entry);if (body === null) return;
        const missing = providerMissingNewLines(fold, bound.entry.readLines?.() ?? []);if (missing.length === 0) return;
        const step = this.feature.nextContext(bound.entry, missing);
        if (step === null || !step.current() || !bound.lease.current() || signal.aborted || !open()) return;
        step.activate();
        const progressed = await this.waitForProgress(intent, fold, missing.length, open, signal, Math.min(deadline, Date.now() + 8000));
        if (!progressed) return;this.refresh();
      }
    } catch { /* A retired or unavailable native source leaves its displayed-only outline. */ }
  }

  private waitForProgress(intent: FileIntent, fold: TestFold, previous: number, open: () => boolean, signal: AbortSignal, deadline: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tick = (): void => {
        if (signal.aborted || !open()) { resolve(false);return; }
        const bound = this.lease(intent);
        if (bound === null || this.source(bound.entry) === null) { resolve(false);return; }
        if (providerMissingNewLines(fold, bound.entry.readLines?.() ?? []).length < previous) { resolve(true);return; }
        if (Date.now() >= deadline) { resolve(false);return; }
        setTimeout(tick, 75);
      };
      tick();
    });
  }
}
