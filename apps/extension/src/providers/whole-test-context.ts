import type { GeldSettings, TestFold } from '@geld/core';
import { providerOutlineContext } from './source-facts';
import type { ProviderNewFileRevision, ProviderOutlineContext } from './source-facts';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffLine, ProviderDiffResult, ProviderDiffView, ProviderPage } from './types';
import { ProviderWholeSourceCache } from './whole-source';
import type { ProviderWholeSourceLease, ProviderWholeSourceReader, ProviderWholeSourceValue } from './whole-source';

export interface ProviderNativeContextStep {
  current(): boolean;
  activate(): void;
  /** Recognize only a newly inserted physical row from this activated native gap; this supplies no source authority. */
  insertedFocus?(target: Element): { readonly row: HTMLElement; readonly newLine: number; readonly newText: string } | null;
}
export interface ProviderWholeFocusOwner { current(): HTMLButtonElement | null }
export interface ProviderWholeSourcePreparation {
  readonly key: string;
  readonly origin: string;
  current(): boolean;
  run(signal: AbortSignal, focus?: HTMLButtonElement): Promise<void>;
}
export interface ProviderWholeTestAdapter {
  readonly readSource: ProviderWholeSourceReader;
  createIntent(doc: Document): { readonly button: HTMLButtonElement; readonly text: HTMLElement };
  intentHost(entry: ProviderDiffEntry): HTMLElement | null;
  contextOmitted(entry: ProviderDiffEntry): boolean;
  nextContext(entry: ProviderDiffEntry, missing: readonly number[]): ProviderNativeContextStep | null;
  paused(origin: string): boolean;
  prepareSource?(entry: ProviderDiffEntry): ProviderWholeSourcePreparation | null;
  readonly keepIntentFocusable?: boolean;
}
export interface ProviderWholeTestSession {
  mount(entry: ProviderDiffEntry): void;
  source(entry: ProviderDiffEntry): ProviderWholeSourceValue | null;
  reveal(entry: ProviderDiffEntry, fold: TestFold, open: () => boolean, focus?: ProviderWholeFocusOwner): void;
  cancelReveal(entry: ProviderDiffEntry): void;
  retain(roots: ReadonlySet<HTMLElement>): void;
}
interface Current { readonly result: ProviderDiffResult; readonly view: ProviderDiffView; readonly context: ProviderOutlineContext; readonly settings: GeldSettings }
interface FileIntent {
  readonly root: HTMLElement; readonly path: string; readonly key: string; readonly subject: string;
  readonly host: HTMLElement; readonly button: HTMLButtonElement; readonly text: HTMLElement;
  readonly preparation: ProviderWholeSourcePreparation | null;
  preparing: boolean;
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
    const preparation = revision === undefined ? this.feature.prepareSource?.(entry) ?? null : null;const key = revision?.key ?? preparation?.key;
    if (!latest?.settings.enabled || !latest.settings.testOutline || key === undefined || host === null || latest.view.filteredPaths.has(entry.path) || !this.feature.contextOmitted(entry)) { this.remove(entry.root);return; }
    let intent = this.files.get(entry.root);
    if (intent !== undefined && (intent.key !== key || intent.subject !== latest.context.subjectKey || intent.host !== host || intent.button.parentElement !== host
      || intent.status === 'idle' && intent.preparation !== null && !intent.preparation.current())) { this.remove(entry.root);intent = undefined; }
    if (intent === undefined) {
      const { button, text } = this.feature.createIntent(this.doc);button.type = 'button';button.classList.add('geld-provider-test-boundaries');button.setAttribute('data-geld-ui', '');button.setAttribute('data-geld-test-boundaries', '');
      intent = { text, root: entry.root, path: entry.path, key, subject: latest.context.subjectKey, host, button, preparation, preparing: false, status: this.attempted.has(key) || this.attempted.size >= 16 ? 'failed' : 'idle', abort: null, reveal: null };
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

  reveal(entry: ProviderDiffEntry, fold: TestFold, open: () => boolean, focus?: ProviderWholeFocusOwner): void {
    const intent = this.files.get(entry.root);if (intent === undefined || this.source(entry) === null) return;
    for (const other of this.files.values()) other.reveal?.abort();
    const abort = new AbortController();intent.reveal = abort;
    const cancel = (event: Event): void => { if (event.isTrusted) abort.abort(); };
    this.doc.addEventListener('pointerdown', cancel, true);this.doc.addEventListener('keydown', cancel, true);
    void this.revealLoop(intent, fold, open, abort, focus).finally(() => {
      this.doc.removeEventListener('pointerdown', cancel, true);this.doc.removeEventListener('keydown', cancel, true);
      if (intent.reveal === abort) intent.reveal = null;
    });
  }

  retain(roots: ReadonlySet<HTMLElement>): void {
    for (const [root, intent] of this.files) {
      if (!roots.has(root)) { this.remove(root);continue; }
      if ((intent.abort !== null || intent.reveal !== null) && !(intent.preparing ? this.preparationCurrent(intent) : this.lease(intent) !== null)) { intent.abort?.abort();intent.reveal?.abort(); }
    }
  }

  retire(): void { this.generation++;for (const root of [...this.files.keys()]) this.remove(root);this.latest = null; }
  destroy(): void { this.retire();this.cache.destroy(); }

  private remove(root: HTMLElement): void { const intent = this.files.get(root);if (intent === undefined) return;intent.abort?.abort();intent.reveal?.abort();intent.button.remove();this.files.delete(root); }
  private label(intent: FileIntent): void {
    intent.text.textContent = intent.status === 'idle' ? 'Find test boundaries' : intent.status === 'loading' ? 'Finding test boundaries…' : intent.status === 'ready' ? 'Test boundaries found' : 'Test boundaries unavailable';
    intent.button.disabled = intent.status !== 'idle' && this.feature.keepIntentFocusable !== true;intent.button.setAttribute('aria-disabled', String(intent.status !== 'idle'));intent.button.dataset.status = intent.status;
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
    let bound = this.lease(intent);
    if (bound === null && !this.preparationCurrent(intent) || this.feature.paused(bound?.lease.revision.repository.origin ?? intent.preparation?.origin ?? '')) return;
    const focus = this.doc.activeElement === intent.button ? intent.button : undefined;
    this.attempted.add(intent.key);const abort = new AbortController();intent.abort = abort;intent.status = 'loading';this.label(intent);
    try {
      if (bound === null) {
        intent.preparing = true;await intent.preparation?.run(abort.signal, focus);intent.preparing = false;
        bound = this.lease(intent);if (bound === null || abort.signal.aborted) throw new Error('Source preparation changed');
      }
      const body = await this.cache.load(bound.lease, abort.signal);
      const fresh = this.lease(intent);if (abort.signal.aborted || fresh === null) { intent.status = 'failed';return; }
      intent.status = providerWholeSourceAgrees(body.lines, fresh.entry.readLines?.() ?? []) ? 'ready' : 'failed';
    } catch { if (this.files.get(intent.root) === intent) intent.status = 'failed'; }
    finally { intent.preparing = false;if (intent.abort === abort) intent.abort = null;if (this.files.get(intent.root) === intent) { this.label(intent);this.refresh(); } }
  }

  private preparationCurrent(intent: FileIntent): boolean {
    try {
      const latest = this.latest, preparation = intent.preparation;
      if (preparation === null || !preparation.current() || this.doc.defaultView === null || this.doc.hidden || this.files.get(intent.root) !== intent
        || !latest?.settings.enabled || !latest.settings.testOutline || latest.context.subjectKey !== intent.subject || !intent.root.isConnected) return false;
      const page = this.adapter.describe(new URL(this.doc.URL), this.doc), view = this.adapter.readDiff(this.doc);
      const entry = view?.entries.find((file) => file.root === intent.root && file.path === intent.path);
      return page !== null && view !== null && entry !== undefined && !view.filteredPaths.has(intent.path) && entry.isExpanded?.() === true
        && intent.root.closest('[hidden], [inert], [aria-hidden="true"], [data-geld-provider-hidden="closed"]') === null
        && this.doc.defaultView.getComputedStyle(intent.root).display !== 'none' && providerOutlineContext(page, latest.result, view).subjectKey === intent.subject;
    } catch { return false; }
  }

  private async revealLoop(intent: FileIntent, fold: TestFold, open: () => boolean, abort: AbortController, focus?: ProviderWholeFocusOwner): Promise<void> {
    const signal = abort.signal, deadline = Date.now() + 30_000;let handedOff = false;
    try {
      for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        if (signal.aborted || !open()) return;
        const bound = this.lease(intent);if (bound === null || this.feature.paused(bound.lease.revision.repository.origin)) return;
        const body = this.source(bound.entry);if (body === null) return;
        const missing = providerMissingNewLines(fold, bound.entry.readLines?.() ?? []);if (missing.length === 0) return;
        const step = this.feature.nextContext(bound.entry, missing);
        if (step === null || !step.current() || !bound.lease.current() || signal.aborted || !open()) return;
        const stepDeadline = Math.min(deadline, Date.now() + 8000), control = focus?.current(), url = this.doc.URL;
        const canHandOff = !handedOff && step.insertedFocus !== undefined && control !== undefined && control !== null && this.doc.activeElement === control && control.isConnected && intent.root.contains(control);
        const dispose = (): void => { this.doc.removeEventListener('focusin', focused, true);signal.removeEventListener('abort', dispose); };
        const focused = (event: FocusEvent): void => {
          if (event.target === control) return;
          try {
            const target = event.target;
            const fresh = this.lease(intent), value = fresh === null ? null : this.source(fresh.entry);
            const candidate = target instanceof Element ? step.insertedFocus?.(target) : null;
            const shown = candidate === null || candidate === undefined || fresh === null ? undefined : fresh.entry.readLines?.().find((line) => line.root === candidate.row && line.newLine === candidate.newLine && line.newText === candidate.newText);
            if (!canHandOff || handedOff || signal.aborted || Date.now() >= stepDeadline || !open() || this.doc.URL !== url || focus?.current() !== control || this.doc.activeElement !== target
              || fresh === null || !fresh.lease.current() || value === null || value.token !== body.token || candidate === null || candidate === undefined || shown === undefined
              || !missing.includes(candidate.newLine) || value.lines[candidate.newLine - 1] !== candidate.newText || !control?.isConnected || !intent.root.contains(control)) { dispose();abort.abort();return; }
            // Focus event trust is not user intent. Only this live operation plus immutable NEW-side agreement permits one return.
            handedOff = true;dispose();control.focus({ preventScroll: true });
          } catch { dispose();abort.abort(); }
        };
        if (canHandOff) { this.doc.addEventListener('focusin', focused, true);signal.addEventListener('abort', dispose, { once: true }); }
        let progressed: boolean;
        try { step.activate();progressed = await this.waitForProgress(intent, fold, missing.length, open, signal, stepDeadline); }
        finally { dispose(); }
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
