import type { ProviderDiffResult, ProviderNativeView, ProviderPage } from '../providers/types';
import { parseProviderDiffSourceFacts, providerSourceId, providerSourcePath, providerSourceSubject, providerSourceSubjectKey, providerNativeSourceElement } from '../providers/source-facts';
import { readGitLabPageFrame, record, SHA } from './page';

interface NativeFile {
  readonly root: HTMLElement;
  readonly path: string;
  readonly serialized: string;
  readonly anchor: string;
  readonly baseSha: string;
  readonly startSha: string;
  readonly headSha: string;
}

export interface GitLabRenderedView {
  readonly key: string;
  readonly sourceId: string;
  readonly sourceHeadSha: string;
  readonly subjectKey: string;
  readonly files: readonly NativeFile[];
  readonly showWhitespace: boolean;
}

interface Lease {
  readonly root: HTMLElement;
  readonly field: HTMLInputElement;
  readonly other: HTMLInputElement;
  readonly opener: HTMLButtonElement;
  readonly menu: HTMLElement;
  readonly list: HTMLElement;
  readonly overlay: HTMLElement;
  readonly loading: HTMLElement;
  readonly alert: HTMLElement;
  readonly owners: readonly { readonly node: HTMLElement; readonly parent: ParentNode | null }[];
  readonly actor: HTMLElement;
  readonly actorId: string | null;
  readonly actorData: string | null;
  readonly url: string;
  readonly projectId: string;
  readonly projectPath: string;
  readonly serialized: string;
  readonly subjectKey: string;
  readonly sourceId: string;
  readonly sourceHeadSha: string;
  readonly targetHeadSha: string;
  readonly reloadSourcePinned: boolean;
}

interface Epoch {
  readonly id: number;
  readonly showWhitespace: boolean;
  readonly original: readonly NativeFile[];
  stage: 'input' | 'overlay' | 'cleared' | 'streaming' | 'finished';
  records: number;
  readonly removed: Set<HTMLElement>;
}

interface SessionHistory { interacted: boolean; invalidated: boolean }
const history = new WeakMap<Document, Map<string, SessionHistory>>();
const sessions = new WeakMap<Document, GitLabNativeWhitespace>();
const EXCLUDED = '[data-geld-ui], .note, .note-text, .md, [data-testid="noteable-note-container"], [data-testid="description-content"], form, [contenteditable], dialog, [role="dialog"]';
const MARKERS = '[data-diffs-list], [data-diffs-overlay], [data-list-loading], [data-diffs-list-alert]';

function original(node: Element): boolean { return node.isConnected && node.closest(EXCLUDED) === null; }
function dialogs(doc: Document): boolean {
  return [...doc.querySelectorAll<HTMLElement>('dialog,[role="dialog"],[aria-modal="true"]')].some((node) => node.closest('[data-geld-ui], .note, .note-text, .md, [data-testid="description-content"]') === null
    && node.closest('[hidden],[inert],[aria-hidden="true"]') === null && doc.defaultView?.getComputedStyle(node).display !== 'none');
}
function one<T extends HTMLElement>(root: ParentNode, selector: string, guard: (node: Element) => node is T): T | null {
  const nodes = [...root.querySelectorAll(selector)].filter(original);
  return nodes.length === 1 && guard(nodes[0]!) ? nodes[0]! : null;
}
function html(node: Element): node is HTMLElement { return node instanceof HTMLElement; }
function input(node: Element): node is HTMLInputElement { return node instanceof HTMLInputElement; }
function button(node: Element): node is HTMLButtonElement { return node instanceof HTMLButtonElement; }
function route(doc: Document): string { const url = new URL(doc.URL);url.hash = '';return url.href; }
function selected(values: unknown): Record<string, unknown> | null {
  if (!Array.isArray(values) || values.length > 1024) return null;
  const selected = values.filter((entry: unknown) => record(entry) && entry.selected === true);
  return selected.length === 1 && record(selected[0]) ? selected[0] : null;
}

export function gitLabNativeResource(value: unknown, origin: string, repository: string, sha: string, path: string, raw: boolean): boolean {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value, origin);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const owner = repository.split('/').map(encodeURIComponent).join('/');
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === `/${owner}/-/${raw ? 'raw' : 'blob'}/${sha}/${encoded}${raw ? '' : '/diff_lines'}`;
  } catch { return false; }
}

function lease(doc: Document): Lease | null {
  const root = one(doc, '[data-rapid-diffs][data-app-data]', html);
  if (root === null) return null;
  const frame = readGitLabPageFrame(doc, root);
  if (frame === null || frame.page.kind !== 'diff' || frame.page.provider !== 'gitlab' || frame.page.repository.origin !== 'https://gitlab.com') return null;
  const { page, appData: app } = frame;
  if (dialogs(doc)) return null;
  if (frame.serialized === null || app.file_by_file_mode !== false || (app.is_fork !== false && app.is_fork !== 'false') || app.project_path !== page.repository.path || app.mr_path !== new URL(page.url).pathname
    || providerSourceId(app.iid) !== page.number || doc.body.dataset.projectFullPath !== page.repository.path || providerSourceId(doc.body.dataset.projectId) === null) return null;
  const versions = record(app.versions) ? app.versions : null;
  const source = selected(versions?.source_versions);const target = selected(versions?.target_versions);
  const sourceId = providerSourceId(source?.id);
  if (sourceId === null || typeof source?.head_sha !== 'string' || !SHA.test(source.head_sha) || source.is_merge_head !== false
    || typeof target?.head_sha !== 'string' || !SHA.test(target.head_sha) || providerSourceId(target.id) === null || typeof target.is_merge_head !== 'boolean') return null;
  const currentUrl = new URL(doc.URL);
  if (currentUrl.searchParams.getAll('diff_id').length > 1 || currentUrl.searchParams.has('diff_id') && currentUrl.searchParams.get('diff_id') !== sourceId || currentUrl.searchParams.has('commit_id') || currentUrl.searchParams.has('only_context_commits')) return null;
  if (['start_sha', 'w', 'view'].some((name) => currentUrl.searchParams.getAll(name).length > 1)) return null;
  let reloadSourcePinned = false;
  try {
    const stream = typeof app.reload_stream_url === 'string' ? new URL(app.reload_stream_url, currentUrl.origin) : null;
    reloadSourcePinned = stream !== null && stream.origin === currentUrl.origin && stream.pathname === `${app.mr_path}/diffs_stream` && !stream.username && !stream.password && !stream.hash
      && stream.searchParams.getAll('diff_id').length === 1 && stream.searchParams.get('diff_id') === sourceId
      && ['inline', 'parallel'].includes(typeof app.diff_view_type === 'string' ? app.diff_view_type : '')
      && [...stream.searchParams].every(([name, value]) => name === 'diff_id' || name === 'start_sha' && SHA.test(value));
  } catch { /* A qualified native choice does not prove an unpinned reload source. */ }
  const actor = one(doc, '#js-vue-mr-discussions[data-current-user-data]', html);
  if (actor === null) return null;
  const actorData = actor.getAttribute('data-current-user-data');let actorId: string | null;
  try {
    const value: unknown = JSON.parse(actorData ?? 'null');
    if (value !== null && !record(value)) return null;
    actorId = value === null || value.id == null ? null : providerSourceId(value.id);
    if (value !== null && value.id != null && actorId === null) return null;
  } catch { return null; }
  if (actorId === null && [...doc.querySelectorAll('.js-mr-title-actions[data-is-signed-in="true"]')].some(original)) return null;
  if (actorId === null && ![...doc.querySelectorAll<HTMLAnchorElement>('a[data-testid="topbar-signin-button"]')].some((node) => {
    try { const url = new URL(node.href);return original(node) && url.origin === currentUrl.origin && url.pathname === '/users/sign_in'; } catch { return false; }
  })) return null;
  const owner = one(root, ':scope > header.rd-app-header[aria-label="View controls"] .gl-new-dropdown[aria-label="Preferences"]', html);
  if (owner === null) return null;
  const opener = one(owner, 'button.js-show-diff-settings[data-testid="base-dropdown-toggle"][role="combobox"]', button);
  const menu = one(owner, '[data-testid="base-dropdown-menu"]', html);
  if (opener === null || menu === null || opener.disabled || opener.type !== 'button' || !['true', 'false'].includes(opener.getAttribute('aria-expanded') ?? '') || opener.getAttribute('aria-disabled') === 'true') return null;
  const field = one(menu, 'input[type="checkbox"][data-testid="show-whitespace"]', input);
  const other = one(menu, 'input[type="checkbox"][data-testid="file-by-file"]', input);
  if (field === null || other === null || other.checked || menu.querySelectorAll('input,select,textarea,form,[contenteditable],button,a,[role="dialog"]').length !== 2) return null;
  const labels: HTMLElement[] = [];
  for (const [control, text] of [[field, 'Show whitespace changes'], [other, 'Show one file at a time']] as const) {
    const label = [...menu.querySelectorAll<HTMLLabelElement>('label[for]')].filter((node) => node.htmlFor === control.id);
    if (control.disabled || control.readOnly || control.value !== 'true' || control.closest('[inert],[aria-disabled="true"],[aria-readonly="true"]') !== null || !control.id || doc.getElementById(control.id) !== control
      || [...doc.querySelectorAll('[id]')].filter((node) => node.id === control.id).length !== 1 || label.length !== 1 || label[0]?.textContent?.replace(/\s+/g, ' ').trim() !== text) return null;
    labels.push(label[0]!);
  }
  const list = one(root, '[data-diffs-list]', html);const overlay = one(root, '[data-diffs-overlay]', html);
  const loading = one(root, '[data-list-loading]', html);const alert = one(root, '[data-diffs-list-alert]', html);
  if (list === null || overlay === null || loading === null || alert === null) return null;
  const owners = [root, owner, opener, menu, field, other, ...labels, list, overlay, loading, alert, actor].map((node) => ({ node, parent: node.parentNode }));
  return { root, field, other, opener, menu, list, overlay, loading, alert, owners, actor, actorData, actorId, url: route(doc),
    projectId: doc.body.dataset.projectId!, projectPath: page.repository.path, serialized: frame.serialized,
    subjectKey: providerSourceSubjectKey(providerSourceSubject(page)), sourceId, sourceHeadSha: source.head_sha.toLowerCase(), targetHeadSha: target.head_sha.toLowerCase(), reloadSourcePinned };
}

function files(doc: Document, owner: Lease, expected: ReadonlySet<string>): readonly NativeFile[] | null {
  const roots = [...owner.root.querySelectorAll<HTMLElement>('diff-file[data-file-data]')].filter((node) => node.closest('[data-geld-ui]') === null);
  if (expected.size === 0 || roots.length !== expected.size || roots.length > 6000) return null;
  const output: NativeFile[] = [];const paths = new Set<string>();
  const ids = new Map<string, number>();
  for (const node of doc.querySelectorAll('[id]')) ids.set(node.id, (ids.get(node.id) ?? 0) + 1);
  for (const root of roots) {
    const serialized = root.getAttribute('data-file-data');
    if (serialized === null || serialized.length > 16384 || new TextEncoder().encode(serialized).byteLength > 16384 || !owner.list.contains(root) || !providerNativeSourceElement(root) || root.closest('[data-rapid-diffs]') !== owner.root
      || !SHA.test(root.id) || ids.get(root.id) !== 1 || root.lastElementChild?.tagName !== 'DIFF-FILE-MOUNTED') return null;
    let value: unknown;try { value = JSON.parse(serialized); } catch { return null; }
    const data = record(value) ? value : null;const refs = data?.diff_refs;
    if (!providerSourcePath(data?.new_path) || !expected.has(data.new_path) || paths.has(data.new_path) || !record(refs)
      || typeof refs.base_sha !== 'string' || !SHA.test(refs.base_sha) || typeof refs.start_sha !== 'string' || !SHA.test(refs.start_sha) || typeof refs.head_sha !== 'string' || !SHA.test(refs.head_sha)) return null;
    const headSha = refs.head_sha.toLowerCase();
    if (!gitLabNativeResource(data.blob_raw_path, 'https://gitlab.com', owner.projectPath, headSha, data.new_path, true)
      || !gitLabNativeResource(data.diff_lines_path, 'https://gitlab.com', owner.projectPath, headSha, data.new_path, false)) return null;
    paths.add(data.new_path);output.push({ root, path: data.new_path, serialized, anchor: root.id, headSha, baseSha: refs.base_sha.toLowerCase(), startSha: refs.start_sha.toLowerCase() });
  }
  const first = output[0];
  const current = [...owner.root.querySelectorAll('diff-file[data-file-data]')].filter((node) => node.closest('[data-geld-ui]') === null);
  return first !== undefined && current.length === roots.length && current.every((node, index) => node === roots[index])
    && output.every((file) => owner.list.contains(file.root) && file.root.id === file.anchor && file.root.getAttribute('data-file-data') === file.serialized && file.headSha === first.headSha && file.baseSha === first.baseSha && file.startSha === first.startSha) ? output : null;
}

export function readGitLabRenderedView(doc: Document, root: HTMLElement): GitLabRenderedView | null | undefined {
  const session = sessions.get(doc);
  if (session !== undefined) return session.read(root);
  const known = history.get(doc)?.get(route(doc));
  return known?.interacted === true || known?.invalidated === true ? null : undefined;
}

export function currentGitLabRenderedView(doc: Document, root: HTMLElement, rendered: GitLabRenderedView): boolean {
  return sessions.get(doc)?.matches(root, rendered) === true;
}

export class GitLabNativeWhitespace implements ProviderNativeView {
  private owner: Lease | null = null;
  private inventory: ReadonlySet<string> | null = null;
  private original: readonly NativeFile[] | null = null;
  private epoch: Epoch | null = null;
  private rendered: GitLabRenderedView | null = null;
  private counter = 0;
  private memory: SessionHistory;
  private scope: string;
  private readonly observer: MutationObserver;
  private stopped = false;
  private draining = false;
  private gesture: HTMLInputElement | null = null;
  private gestureTimer: ReturnType<typeof setTimeout> | null = null;
  private validated: GitLabRenderedView | null = null;

  constructor(private readonly doc: Document, private readonly changed: () => void, private readonly choice: (url: URL, showWhitespace: boolean) => void, private readonly trusted: (event: Event) => boolean = (event) => event.isTrusted) {
    sessions.get(doc)?.stop();sessions.set(doc, this);
    this.scope = route(doc);
    const scopes = history.get(doc) ?? new Map<string, SessionHistory>();history.set(doc, scopes);
    this.memory = scopes.get(this.scope) ?? { interacted: false, invalidated: false };scopes.set(this.scope, this.memory);
    this.observer = new MutationObserver((records) => this.process(records));
    this.observer.observe(doc, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
    doc.addEventListener('change', this.input, true);
    doc.addEventListener('click', this.click, true);
  }

  update(page: ProviderPage | null, result: ProviderDiffResult | null): void {
    this.drain();
    this.syncScope();
    if (this.stopped) return;
    if (this.owner !== null && !this.owns()) this.invalidate();
    if (this.owner === null && !this.memory.invalidated) this.owner = lease(this.doc);
    const owner = this.owner;
    if (owner === null || !owner.reloadSourcePinned || page === null || providerSourceSubjectKey(providerSourceSubject(page)) !== owner.subjectKey || this.memory.interacted || result?.complete !== true) return;
    const facts = parseProviderDiffSourceFacts(result.sourceFacts);
    if (facts === null || providerSourceSubjectKey(facts.subject) !== owner.subjectKey || facts.comparison.kind !== 'gitlab-review' || facts.comparison.diffId !== owner.sourceId || facts.comparison.headSha !== owner.sourceHeadSha || facts.comparison.projectPath !== owner.projectPath) return;
    const eligible = new Map(facts.newPaths.map((file) => [file.path, file.newPath]));
    // Deleted/unsupported files never acquire new-side authority from a fabricated replacement path.
    if (result.files.some((file) => file.status === 'deleted' || eligible.get(file.path) !== file.path)) return;
    const expected = new Set(eligible.values());
    if (expected.size !== result.files.length) return;
    const baseline = files(this.doc, owner, expected);
    if (baseline === null || !this.idle() || baseline.some((file) => file.headSha !== owner.targetHeadSha)) return;
    this.inventory = expected;this.original = baseline;
  }

  private syncScope(): void {
    const scope = route(this.doc);
    if (scope === this.scope) return;
    if (this.memory.interacted) this.memory.invalidated = true;
    this.owner = null;this.inventory = null;this.original = null;this.epoch = null;this.rendered = null;this.scope = scope;
    const scopes = history.get(this.doc) ?? new Map<string, SessionHistory>();history.set(this.doc, scopes);
    this.memory = scopes.get(scope) ?? { interacted: false, invalidated: false };scopes.set(scope, this.memory);
  }

  private owns(): boolean {
    const current = this.owner;const now = lease(this.doc);
    return current !== null && now !== null && current.owners.every(({ node, parent }, index) => node === now.owners[index]?.node && node.parentNode === parent)
      && route(this.doc) === current.url && this.doc.body.dataset.projectId === current.projectId && now.serialized === current.serialized && now.actorData === current.actorData && now.actorId === current.actorId && now.subjectKey === current.subjectKey;
  }

  private idle(): boolean { return this.owner !== null && !this.owner.overlay.hasAttribute('data-loading') && this.owner.loading.hidden && this.owner.alert.childNodes.length === 0; }

  private readonly input = (event: Event): void => {
    if (!this.trusted(event) || this.stopped) return;
    this.drain();
    this.syncScope();
    if (this.owner !== null && event.target instanceof Element && event.target !== this.owner.field && event.target.closest('[data-geld-ui]') === null
      && this.owner.root.querySelector(':scope > header.rd-app-header')?.contains(event.target)) { this.invalidate();return; }
    const now = lease(this.doc);
    if (now === null || event.target !== now.field || this.gesture !== now.field) return;
    this.clearGesture();
    if (this.owner === null && !this.memory.interacted && !this.memory.invalidated) this.owner = now;
    if (!this.owns()) { this.invalidate();return; }
    this.memory.interacted = true;
    this.choice(new URL(this.doc.URL), now.field.checked);
    if (this.memory.invalidated || this.epoch !== null || this.inventory === null || this.original === null || !this.idle()) { this.invalidate();return; }
    this.rendered = null;
    this.epoch = { id: ++this.counter, showWhitespace: now.field.checked, original: this.original, stage: 'input', records: 0, removed: new Set() };
    this.changed();
  };

  private readonly click = (event: Event): void => {
    this.clearGesture();
    if (!this.trusted(event) || this.stopped) return;
    this.drain();this.syncScope();
    const now = lease(this.doc);
    if (now === null || !(event.target instanceof Element)) return;
    const target = event.target.closest('input,label');
    if (target !== now.field && !(target instanceof HTMLLabelElement && target.control === now.field)) return;
    if (this.owner === null) this.owner = now;
    if (!this.owns()) return;
    this.gesture = now.field;
    this.gestureTimer = setTimeout(() => this.clearGesture(), 0);
  };

  private clearGesture(): void {
    this.gesture = null;
    if (this.gestureTimer !== null) clearTimeout(this.gestureTimer);
    this.gestureTimer = null;
  }

  private invalidate(): void {
    if (this.owner === null && !this.memory.interacted) return;
    const change = !this.memory.invalidated || this.rendered !== null || this.epoch !== null;
    this.memory.invalidated = true;this.rendered = null;this.epoch = null;
    if (change) this.changed();
  }

  private process(records: readonly MutationRecord[]): void {
    if (this.stopped || records.length === 0 || this.owner === null) return;
    this.validated = null;
    const owner = this.owner;
    if (!this.owns()) { this.invalidate();return; }
    for (let index = 0; index < records.length; index += 1) {
      const mutation = records[index]!;
      if (mutation.type === 'attributes' && (mutation.target === owner.root && mutation.attributeName === 'data-app-data'
        || mutation.target === owner.actor && mutation.attributeName === 'data-current-user-data'
        || mutation.target === this.doc.body && ['data-project-id', 'data-project-full-path'].includes(mutation.attributeName ?? ''))) { this.invalidate();return; }
      if (mutation.type === 'attributes' && (mutation.target === owner.field || mutation.target === owner.other)
        && ['id', 'type', 'value', 'disabled', 'readonly', 'data-testid', 'aria-disabled', 'aria-readonly'].includes(mutation.attributeName ?? '')) { this.invalidate();return; }
      if (mutation.type === 'childList') {
        if ([...mutation.removedNodes].some((node) => owner.owners.some(({ node: original }) => node === original || node.contains(original)))) { this.invalidate();return; }
        if ((mutation.target === owner.alert || owner.alert.contains(mutation.target)) && mutation.addedNodes.length > 0) { this.invalidate();return; }
        if ([...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && (node.matches('dialog,[role="dialog"],[aria-modal="true"]') || node.querySelector('dialog,[role="dialog"],[aria-modal="true"]') !== null)
          && node.closest('[data-geld-ui], .note, .note-text, .md') === null)) { this.invalidate();return; }
        if ((mutation.target === owner.menu || owner.menu.contains(mutation.target)) && [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element
          && (node.matches('input,select,textarea,form,[contenteditable]') || node.querySelector('input,select,textarea,form,[contenteditable]') !== null))) { this.invalidate();return; }
        if ([...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && (node.matches(MARKERS) || node.querySelector(MARKERS) !== null))) { this.invalidate();return; }
      }
      const epoch = this.epoch;
      if (epoch === null) continue;
      if (++epoch.records > 4096) { this.invalidate();return; }
      if (mutation.type === 'attributes' && (mutation.target === owner.overlay && mutation.attributeName === 'data-loading' || mutation.target === owner.loading && mutation.attributeName === 'hidden')) {
        const later = records.slice(index + 1).find((next) => next.type === 'attributes' && next.target === mutation.target && next.attributeName === mutation.attributeName);
        const after = later === undefined ? (mutation.target instanceof Element ? mutation.target.getAttribute(mutation.attributeName!) : null) : later.oldValue;
        if (mutation.target === owner.overlay && mutation.oldValue === null && after === 'true' && epoch.stage === 'input') epoch.stage = 'overlay';
        else if (mutation.target === owner.overlay && mutation.oldValue === 'true' && after === null && epoch.stage === 'cleared') { /* Native all-files stream starts immediately after overlay clear. */ }
        else if (mutation.target === owner.loading && mutation.oldValue !== null && after === null && epoch.stage === 'cleared') epoch.stage = 'streaming';
        else if (mutation.target === owner.loading && mutation.oldValue === null && after !== null && epoch.stage === 'streaming') epoch.stage = 'finished';
        else { this.invalidate();return; }
      }
      if (mutation.type === 'childList' && epoch.stage === 'overlay') {
        for (const file of epoch.original) if ([...mutation.removedNodes].some((node) => node === file.root || node.contains(file.root))) epoch.removed.add(file.root);
        if (epoch.removed.size === epoch.original.length) epoch.stage = 'cleared';
      }
      if (mutation.type === 'childList' && epoch.stage !== 'input' && epoch.stage !== 'overlay' && [...mutation.addedNodes].some((node) => epoch.original.some((file) => node === file.root || node.contains(file.root)))) { this.invalidate();return; }
    }
    this.finish();
  }

  private finish(): void {
    const owner = this.owner;const epoch = this.epoch;
    if (owner === null || epoch?.stage !== 'finished' || this.inventory === null) return;
    const current = files(this.doc, owner, this.inventory);
    if (!this.owns() || !this.idle() || owner.field.checked !== epoch.showWhitespace || current === null || current.some((file) => epoch.original.some((old) => old.root === file.root))) { this.invalidate();return; }
    this.rendered = { key: JSON.stringify([owner.subjectKey, epoch.id, epoch.showWhitespace, current.map((file) => [file.path, file.baseSha, file.startSha, file.headSha])]),
      subjectKey: owner.subjectKey, sourceId: owner.sourceId, sourceHeadSha: owner.sourceHeadSha, files: current, showWhitespace: epoch.showWhitespace };
    this.original = current;this.epoch = null;this.changed();
  }

  private drain(): void {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try { this.process(this.observer.takeRecords()); } finally { this.draining = false; }
  }

  read(root: HTMLElement): GitLabRenderedView | null | undefined {
    this.drain();
    this.syncScope();
    if (!this.memory.interacted && !this.memory.invalidated) return undefined;
    if (this.owner === null || root !== this.owner.root || !this.owns()) { this.invalidate();return null; }
    const current = this.rendered;
    if (current === null || this.inventory === null) return null;
    if (!this.idle() || this.owner.field.checked !== current.showWhitespace) { this.invalidate();return null; }
    if (this.validated === current) return current;
    const found = files(this.doc, this.owner, this.inventory);
    if (found === null || !this.owns() || !this.idle() || this.owner.field.checked !== current.showWhitespace || found.length !== current.files.length || found.some((file, index) => file.root !== current.files[index]?.root || file.anchor !== current.files[index]?.anchor || file.serialized !== current.files[index]?.serialized)) { this.invalidate();return null; }
    this.validated = current;
    return current;
  }

  matches(root: HTMLElement, rendered: GitLabRenderedView): boolean {
    return !this.stopped && this.read(root) === rendered;
  }

  suspended(): boolean {
    this.drain();
    this.syncScope();
    if (this.owner !== null && !this.owns()) this.invalidate();
    return this.epoch !== null || this.memory.interacted && this.owner !== null && this.owns() && !this.idle();
  }

  sourceUnavailable(): boolean {
    this.drain();this.syncScope();
    return this.memory.interacted || this.memory.invalidated ? this.owner === null || this.read(this.owner.root) == null : false;
  }

  stop(): void {
    this.drain();this.clearGesture();this.stopped = true;this.observer.disconnect();this.doc.removeEventListener('change', this.input, true);this.doc.removeEventListener('click', this.click, true);
    if (this.memory.interacted) this.memory.invalidated = true;
    if (sessions.get(this.doc) === this) sessions.delete(this.doc);
  }
}
