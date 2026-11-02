import { describeRepository, repositoryKey } from '@geld/core';
import type { RepositoryIdentity } from '@geld/core';
import { parseProviderDiffSourceFacts, providerBitbucketComparisonKey, providerBitbucketReferenceResolution, providerSourceSubject, providerSourceSubjectKey } from '../providers/source-facts';
import type { ProviderDiffSourceFacts, ProviderNativeSourceFrame, ProviderNativeSourceReference } from '../providers/source-facts';
import type { ProviderDiffEntry, ProviderDiffResult, ProviderNativeView, ProviderPage } from '../providers/types';
import type { ProviderWholeSourcePreparation } from '../providers/whole-test-context';

const excluded = '[data-geld-ui],.ak-renderer-document,[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"],form,input,textarea,[contenteditable]';
const popupSelector = '[role="menu"],[role="listbox"],[role="dialog"],[popover]';
const readers = new WeakMap<Document, BitbucketSourceReferences>();
interface GlobalFrame { readonly key: string; readonly region: HTMLElement; readonly watched: readonly HTMLElement[]; current(): boolean }
interface FileFrame { readonly root: HTMLElement; readonly opener: HTMLButtonElement; current(): boolean }
interface Active { readonly key: string; readonly page: ProviderPage; readonly facts: ProviderDiffSourceFacts; frame: GlobalFrame | null }
interface Captured { readonly reference: ProviderNativeSourceReference; readonly popup: HTMLElement; readonly link: HTMLAnchorElement; readonly parent: Element | null; readonly popupParent: Element | null }
interface Seal { readonly file: FileFrame; readonly captured: Captured }
interface Selection { readonly active: Active; readonly frame: GlobalFrame; readonly file: FileFrame; readonly path: string; readonly repository: RepositoryIdentity; readonly key: string; current(): boolean }
interface SourceRow { readonly row: HTMLElement; readonly parent: Element | null; readonly code: HTMLElement; readonly numbers: Element; readonly old: string | null; readonly next: string | null; readonly text: string; readonly kind: string }
function native(node: Element): boolean { return node.isConnected && node.closest(excluded) === null; }
function shown(node: HTMLElement): boolean {
  if (!native(node) || node.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
  for (let item: HTMLElement | null = node; item !== null; item = item.parentElement) {
    const style = item.ownerDocument.defaultView?.getComputedStyle(item);
    if (style === undefined || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
  }
  const box = node.getBoundingClientRect();return box.width > 0 && box.height > 0;
}
function popups(doc: Document): HTMLElement[] {
  const roots = [...doc.querySelectorAll<HTMLElement>(popupSelector)].filter(shown);
  return roots.filter((node) => !roots.some((other) => other !== node && other.contains(node)));
}
function route(doc: Document): string { const url = new URL(doc.URL);url.hash = '';return url.href; }

function globalFrame(doc: Document, page: ProviderPage, epoch: number): GlobalFrame | null {
  const url = new URL(doc.URL);
  if (page.diffMode?.current() === false || page.kind !== 'diff' || page.provider !== 'bitbucket' || url.search !== '' || url.origin !== page.repository.origin) return null;
  const headers = [...doc.querySelectorAll<HTMLElement>('[data-testid="pr-header"]')].filter(native), header = headers[0];
  const regions = [...doc.querySelectorAll<HTMLElement>('[role="region"][aria-label="Diff"]')].filter(native), region = regions[0];
  if (headers.length !== 1 || header === undefined || regions.length !== 1 || region === undefined) return null;
  const branches = header.querySelector<HTMLElement>('[data-qa="pr-branches-and-state-styles"]'), metadata = branches?.nextElementSibling;
  if (branches === null || branches === undefined || !(metadata instanceof HTMLElement) || !native(branches) || !native(metadata)
    || /^#([1-9]\d*)\s*•/.exec(metadata.textContent?.trim() ?? '')?.[1] !== page.number) return null;
  const selections = [...doc.querySelectorAll<HTMLElement>('button[aria-haspopup="true"],[role="button"][aria-haspopup="true"]')].filter((node) => shown(node) && node.textContent?.trim() === 'All changes' && node.getAttribute('aria-expanded') === 'false');
  const selection = selections[0];
  const controls = [...branches.querySelectorAll<HTMLElement>('[role="button"][aria-haspopup="true"]')].filter(shown);
  if (selections.length !== 1 || selection === undefined || controls.length !== 2 || controls.some((node) => node.getAttribute('aria-expanded') !== 'false')) return null;
  const links = [...header.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((link) => {
    try { const value = new URL(link.href);return native(link) && value.origin === page.repository.origin && value.pathname.replace(/\/$/, '') === `/${page.repository.path}/src` && value.search === '' && value.hash === '' && value.username === '' && value.password === ''; } catch { return false; }
  });
  if (links.length === 0) return null;
  const originalRoute = route(doc), originalMeta = metadata.textContent, branchText = controls.map((node) => node.textContent), hrefs = links.map((link) => link.getAttribute('href'));
  const parents = [header, region, branches, metadata, selection, ...controls, ...links].map((node) => node.parentElement);
  const nodes = [header, region, branches, metadata, selection, ...controls, ...links];
  return {
    key: JSON.stringify([providerSourceSubjectKey(providerSourceSubject(page)), epoch]), region, watched: [branches, metadata, selection, ...links],
    current: () => page.diffMode?.current() !== false && route(doc) === originalRoute && nodes.every((node, index) => native(node) && node.parentElement === parents[index])
      && doc.querySelectorAll('[data-testid="pr-header"]').length === 1 && doc.querySelectorAll('[role="region"][aria-label="Diff"]').length === 1
      && [...doc.querySelectorAll<HTMLElement>('button[aria-haspopup="true"],[role="button"][aria-haspopup="true"]')].filter((node) => shown(node) && node.textContent?.trim() === 'All changes').length === 1
      && branches.querySelectorAll('[role="button"][aria-haspopup="true"]').length === 2
      && metadata.textContent === originalMeta && shown(selection) && selection.textContent?.trim() === 'All changes' && selection.getAttribute('aria-expanded') === 'false'
      && controls.every((node, index) => shown(node) && node.textContent === branchText[index] && node.getAttribute('aria-expanded') === 'false')
      && links.every((link, index) => link.getAttribute('href') === hrefs[index]),
  };
}

function sourceRow(row: HTMLElement): SourceRow | null {
  const codes = row.querySelectorAll<HTMLElement>('[data-line-type]'), numberCells = row.querySelectorAll('[data-key="code-line-number"]'), code = codes[0], numbers = numberCells[0];
  if (codes.length !== 1 || code === undefined || numberCells.length !== 1 || numbers === undefined) return null;
  const old = numbers.getAttribute('data-old-line-number'), next = numbers.getAttribute('data-new-line-number'), kind = code.getAttribute('data-line-type'), raw = code.textContent ?? '';
  if (![old, next].every((value) => value === null || /^[1-9]\d*$/.test(value)) || old === null && next === null || kind === null || ![' ', '+', '-'].includes(kind)) return null;
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  if (/[\r\n]/.test(text)) return null;
  if (code.classList.contains('syntax-highlighted') || code.classList.contains('__rbb_syntax_highlight') || raw !== text) {
    const label = kind === '+' ? 'Added' : kind === '-' ? 'Removed' : 'Unchanged';
    if (code.tagName !== 'SPAN' || !code.matches('.code-diff.syntax-highlighted.__rbb_syntax_highlight[role="gridcell"]') || code.getAttribute('aria-label') !== `${label}: ${text}`
      || row.closest('[role="rowgroup"]') === null || !row.parentElement?.matches('[role="row"][data-key="code-line"]')) return null;
  }
  return { row, parent: row.parentElement, code, numbers, old, next, text, kind };
}
function fileFrame(entry: Pick<ProviderDiffEntry, 'root' | 'path'>, region: HTMLElement): FileFrame | null {
  const root = entry.root;
  if (!native(root) || root.parentElement !== region) return null;
  const anchors = root.querySelectorAll(':scope > div[id^="chg-"]'), anchor = anchors[0];
  const articles = root.querySelectorAll<HTMLElement>(':scope > div > article[data-qa="branch-diff-file"]'), article = articles[0];
  if (anchors.length !== 1 || anchor?.id !== `chg-${entry.path}` || articles.length !== 1 || article === undefined) return null;
  const headers = article.querySelectorAll<HTMLElement>('[data-qa="bk-file__header"][data-testid="file-header"]'), header = headers[0];
  const titles = header?.querySelectorAll('h2[data-qa="bk-filepath"]'), title = titles?.[0];
  const menus = header?.querySelectorAll<HTMLElement>('[data-qa="bk-file__menu"]'), menu = menus?.[0];
  const buttons = menu?.querySelectorAll('button'), opener = buttons?.[0];
  if (headers.length !== 1 || header === undefined || titles?.length !== 1 || title?.textContent?.trim() !== entry.path || menus?.length !== 1 || menu === undefined
    || buttons?.length !== 1 || !(opener instanceof HTMLButtonElement) || opener.parentElement !== menu || opener.type !== 'button'
    || opener.getAttribute('aria-haspopup') !== 'true' || opener.querySelectorAll('span[role="img"][aria-label="Diff actions"]').length !== 1) return null;
  const nodes = [root, anchor, article, header, title, menu, opener], parents = nodes.map((node) => node.parentElement);
  const shownRows = [...article.querySelectorAll<HTMLElement>('[data-qa="code-line"]')].filter(native).map(sourceRow);
  if (shownRows.length === 0 || shownRows.some((row) => row === null)) return null;
  return { root, opener, current: () => nodes.every((node, index) => native(node) && node.parentElement === parents[index]) && root.parentElement === region
    && root.querySelectorAll(':scope > div[id^="chg-"]').length === 1 && root.querySelectorAll('article[data-qa="branch-diff-file"]').length === 1
    && article.querySelectorAll('[data-qa="bk-file__header"][data-testid="file-header"]').length === 1 && header.querySelectorAll('h2[data-qa="bk-filepath"]').length === 1
    && header.querySelectorAll('[data-qa="bk-file__menu"]').length === 1 && menu.querySelectorAll('button').length === 1
    && anchor.id === `chg-${entry.path}` && title.textContent?.trim() === entry.path && !opener.disabled && opener.getAttribute('aria-disabled') !== 'true'
    && opener.getAttribute('aria-haspopup') === 'true' && ['false', 'true'].includes(opener.getAttribute('aria-expanded') ?? '') && shown(opener)
    && shownRows.every((before) => {
      if (before === null || !native(before.row) || !article.contains(before.row)) return false;
      const after = sourceRow(before.row);return after !== null && after.parent === before.parent && after.code === before.code && after.numbers === before.numbers
        && after.old === before.old && after.next === before.next && after.text === before.text && after.kind === before.kind;
    }) };
}

function sealCurrent(seal: Seal): boolean {
  const { popup, link, parent, popupParent, reference } = seal.captured;
  return seal.file.current() && (popup.isConnected ? native(popup) && native(link) && popup.contains(link) && link.parentElement === parent && popup.parentElement === popupParent && link.href === reference.url : !link.isConnected);
}

function readPopup(doc: Document, before: ReadonlySet<HTMLElement>, selected: Selection): Captured | null {
  const { active, file, repository, path } = selected;
  if (!selected.current()) throw new Error('Native source preparation changed');
  const added = popups(doc).filter((node) => !before.has(node));if (added.length > 1) throw new Error('Native source popup is ambiguous');
  const popup = added[0];if (popup === undefined || file.opener.getAttribute('aria-expanded') !== 'true') return null;
  if (popup.querySelector('input,select,textarea,[contenteditable]') !== null) throw new Error('Native source popup contains a form');
  const prefix = `/${repository.path.split('/').map(encodeURIComponent).join('/')}/src/`;
  const links = [...popup.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((link) => native(link) && new URL(link.href).origin === repository.origin && new URL(link.href).pathname.startsWith(prefix));
  const link = links[0], comparison = active.facts.comparison;
  if (links.length !== 1 || link === undefined || comparison.kind !== 'bitbucket-review') throw new Error('Native source reference unavailable');
  const url = new URL(link.href), suffix = `/${path.split('/').map(encodeURIComponent).join('/')}`;
  const tail = url.pathname.slice(prefix.length), literalRef = tail.endsWith(suffix) ? tail.slice(0, -suffix.length) : '';
  const resolution = providerBitbucketReferenceResolution(comparison, literalRef), expected = new URL(`${prefix}${literalRef}${suffix}`, repository.origin);
  if (resolution === null || link.href !== expected.href) throw new Error('Native source reference unavailable');
  return { link, popup, parent: link.parentElement, popupParent: popup.parentElement,
    reference: { subject: active.facts.subject, repository, path, literalRef, url: expected.href, comparison: 'bitbucket-all-changes', acquiredComparisonKey: providerBitbucketComparisonKey(comparison), resolution } };
}

function waitFor<T>(doc: Document, signal: AbortSignal, deadline: number, read: () => T | null): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => { observer.disconnect();if (timer !== null) clearTimeout(timer);signal.removeEventListener('abort', aborted); };
    const aborted = (): void => { cleanup();reject(signal.reason ?? new DOMException('Source preparation cancelled', 'AbortError')); };
    const inspect = (): void => {
      if (signal.aborted) { aborted();return; }
      try {
        const value = read();if (value !== null) { cleanup();resolve(value);return; }
        if (Date.now() >= deadline) throw new Error('Native source preparation unavailable');
        if (timer === null) timer = setTimeout(() => { timer = null;inspect(); }, Math.min(100, deadline - Date.now()));
      } catch (error: unknown) { cleanup();reject(error); }
    };
    const observer = new MutationObserver(inspect);observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    signal.addEventListener('abort', aborted, { once: true });inspect();
  });
}

export class BitbucketSourceReferences implements ProviderNativeView {
  private active: Active | null = null;
  private epoch = 0;
  private readonly seals = new Map<HTMLElement, Seal>();
  private operation: AbortController | null = null;
  private observation: AbortController | null = null;
  private readonly observer: MutationObserver;
  private readonly navigated = (): void => this.retireFrame();
  private readonly nativeOpened = (event: Event): void => {
    if (!event.isTrusted || this.operation !== null || this.observation !== null || !(event.target instanceof Element)) return;
    const opener = event.target.closest('button'), article = opener?.closest('article[data-qa="branch-diff-file"]');
    const root = article?.parentElement?.parentElement, path = article?.querySelector('h2[data-qa="bk-filepath"]')?.textContent?.trim();
    if (!(root instanceof HTMLElement) || path === undefined) return;
    let selected = this.selection({ root, path });
    if (selected === null || selected.file.opener !== opener || opener.getAttribute('aria-expanded') !== 'false' || this.seals.size >= 16) return;
    if (this.seals.has(root)) { this.retireFrame();selected = this.selection({ root, path });if (selected === null) return; }
    const capturedSelection = selected;
    const before = new Set(popups(this.doc));if (before.size > 8) return;
    const abort = new AbortController();this.observation = abort;
    void Promise.resolve().then(() => waitFor(this.doc, abort.signal, Date.now() + 2000, () => readPopup(this.doc, before, capturedSelection)))
      .then((captured) => { if (capturedSelection.current() && !abort.signal.aborted) { this.seals.set(root, { file: capturedSelection.file, captured });this.changed(); } })
      .catch(() => undefined).finally(() => { if (this.observation === abort) this.observation = null; });
  };
  constructor(private readonly doc: Document, private readonly changed: () => void) {
    readers.get(doc)?.stop();readers.set(doc, this);
    this.observer = new MutationObserver((records) => {
      const frame = this.active?.frame;
      if (frame === null || frame === undefined) return;
      if (!frame.current() || [...this.seals.values()].some((seal) => !sealCurrent(seal) || seal.captured.popup.isConnected && records.some((record) => record.type === 'attributes' && record.target === seal.captured.link && record.attributeName === 'href'))
        || records.some((record) => frame.watched.some((node) => node === record.target || node.contains(record.target))
        && (record.type !== 'attributes' || ['href', 'aria-expanded'].includes(record.attributeName ?? '')))) this.retireFrame();
    });
    this.observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
    doc.addEventListener('click', this.nativeOpened, true);doc.defaultView?.addEventListener('popstate', this.navigated);doc.defaultView?.addEventListener('pagehide', this.navigated);
  }
  update(page: ProviderPage | null, result: ProviderDiffResult | null): void {
    const pageKey = page === null ? null : providerSourceSubjectKey(providerSourceSubject(page));
    if (page === null || page.provider !== 'bitbucket' || page.kind !== 'diff') { if (this.active !== null) this.retireFrame();this.active = null;return; }
    if (result === null) { if (this.active !== null && providerSourceSubjectKey(this.active.facts.subject) !== pageKey) { this.retireFrame();this.active = null; }return; }
    const facts = parseProviderDiffSourceFacts(result.sourceFacts), comparison = facts?.comparison;
    if (!result.complete || facts === null || providerSourceSubjectKey(facts.subject) !== pageKey || comparison?.kind !== 'bitbucket-review' || comparison.sourceRef === undefined || comparison.sourceRepository === null) { if (this.active !== null) this.retireFrame();this.active = null;return; }
    const key = JSON.stringify([pageKey, result.revision, comparison, facts.newPaths]);
    if (this.active?.key === key) return;
    this.retireFrame();this.active = { key, page, facts, frame: null };
  }
  suspended(): boolean { return false; }
  sourceUnavailable(): boolean { return false; }
  stop(): void { this.observer.disconnect();this.observation?.abort();this.operation?.abort();this.observation = null;this.operation = null;this.doc.removeEventListener('click', this.nativeOpened, true);this.doc.defaultView?.removeEventListener('popstate', this.navigated);this.doc.defaultView?.removeEventListener('pagehide', this.navigated);this.active = null;this.seals.clear();if (readers.get(this.doc) === this) readers.delete(this.doc); }
  private retireFrame(): void { this.observation?.abort();this.operation?.abort();this.observation = null;this.operation = null;this.epoch++;this.seals.clear();if (this.active !== null) this.active.frame = null;this.changed(); }
  private frame(): GlobalFrame | null {
    const active = this.active;if (active === null) return null;
    if (active.frame !== null && !active.frame.current()) this.retireFrame();
    active.frame ??= globalFrame(this.doc, active.page, this.epoch);
    return active.frame;
  }
  readFrame(region: HTMLElement): ProviderNativeSourceFrame | null {
    const frame = this.frame();if (frame === null || frame.region !== region) return null;
    return { key: frame.key, current: () => this.active?.frame === frame && frame.current(), read: () => null, readReference: (entry) => {
      const seal = this.seals.get(entry.root);return this.active?.frame === frame && frame.current() && seal !== undefined && sealCurrent(seal) ? seal.captured.reference : null;
    } };
  }
  prepare(entry: ProviderDiffEntry): ProviderWholeSourcePreparation | null {
    const selected = this.selection(entry);if (selected === null) return null;
    return { key: selected.key, origin: selected.repository.origin, current: selected.current, run: (signal, focus) => this.openSource(selected, signal, focus) };
  }
  private selection(entry: Pick<ProviderDiffEntry, 'root' | 'path'>): Selection | null {
    const active = this.active, frame = this.frame(), comparison = active?.facts.comparison;
    if (active === null || frame === null || comparison?.kind !== 'bitbucket-review' || comparison.sourceRepository === null || comparison.sourceRef === undefined) return null;
    const path = active.facts.newPaths.find((file) => file.path === entry.path)?.newPath, file = fileFrame(entry, frame.region);
    const repository = describeRepository(`${active.page.repository.origin}/${comparison.sourceRepository}`, 'bitbucket');
    if (path === undefined || path !== entry.path || file === null || repository === null) return null;
    const current = (): boolean => this.active === active && active.frame === frame && frame.current() && file.current();
    return { active, frame, file, repository, path, current, key: JSON.stringify([repositoryKey(repository), comparison.headSha, path]) };
  }
  private async openSource(selected: Selection, signal: AbortSignal, focus?: HTMLButtonElement): Promise<void> {
    const { file, frame, active, current } = selected;
    if (this.observation !== null) { this.observation.abort();this.observation = null; }
    if (this.operation !== null || this.seals.size >= 16 || !current() || signal.aborted || file.opener.getAttribute('aria-expanded') !== 'false') throw new Error('Native source preparation unavailable');
    const before = new Set(popups(this.doc)), deadline = Date.now() + 2000, abort = new AbortController();this.operation = abort;let userInterrupted = false, externalFocus = false, nativeFocus = false;
    const restoreFocus = focus !== undefined && this.doc.activeElement === focus && focus.isConnected && file.root.contains(focus);
    const focused = (event: FocusEvent): void => {
      if (!restoreFocus || event.target === focus) return;
      const added = popups(this.doc).filter((node) => !before.has(node));
      if (event.target === file.opener || event.target instanceof Node && added.length === 1 && added[0]?.contains(event.target)) nativeFocus = true;
      else if (event.target !== this.doc.body || !nativeFocus) externalFocus = true;
    };
    const cancelled = (): void => abort.abort(signal.reason);
    const interrupted = (event: Event): void => { if (event.isTrusted) { userInterrupted = true;abort.abort(new DOMException('Source preparation interrupted', 'AbortError')); } };
    signal.addEventListener('abort', cancelled, { once: true });for (const type of ['pointerdown', 'keydown', 'click']) this.doc.addEventListener(type, interrupted, true);this.doc.addEventListener('focusin', focused, true);
    try {
      if (before.size > 8) throw new Error('Native source preparation unavailable');
      file.opener.click();
      const captured = await waitFor(this.doc, abort.signal, deadline, () => readPopup(this.doc, before, selected));
      if (!current() || signal.aborted || abort.signal.aborted || active.frame !== frame) throw new Error('Native source preparation changed');
      if (file.opener.getAttribute('aria-expanded') === 'true') file.opener.click();
      await waitFor(this.doc, abort.signal, deadline, () => { if (!current()) throw new Error('Native source preparation changed');return file.opener.getAttribute('aria-expanded') === 'false' ? true : null; });
      if (captured.link.href !== captured.reference.url) throw new Error('Native source reference changed');
      this.seals.set(file.root, { file, captured });this.changed();
    } finally {
      signal.removeEventListener('abort', cancelled);for (const type of ['pointerdown', 'keydown', 'click']) this.doc.removeEventListener(type, interrupted, true);
      if (!userInterrupted && current() && file.opener.getAttribute('aria-expanded') === 'true') file.opener.click();
      this.doc.removeEventListener('focusin', focused, true);
      const activeFocus = this.doc.activeElement, added = popups(this.doc).filter((node) => !before.has(node));
      if (restoreFocus && !externalFocus && !userInterrupted && current() && focus?.isConnected && file.root.contains(focus)
        && (activeFocus === file.opener || activeFocus === this.doc.body && nativeFocus || activeFocus instanceof Node && added.length === 1 && added[0]?.contains(activeFocus))) focus.focus({ preventScroll: true });
      if (this.operation === abort) this.operation = null;
    }
  }
}

export function bitbucketReferenceFrame(doc: Document, region: HTMLElement): ProviderNativeSourceFrame | null { return readers.get(doc)?.readFrame(region) ?? null; }
export function bitbucketPrepareSource(entry: ProviderDiffEntry): ProviderWholeSourcePreparation | null { return readers.get(entry.root.ownerDocument)?.prepare(entry) ?? null; }
