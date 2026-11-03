// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitLabNativeWhitespace, readGitLabRenderedView } from './native-whitespace';
import { describeGitLabPage, record } from './page';
import { readGitLabDiff } from './diff';
import { providerDiffSourceFacts, providerOutlineContext } from '../providers/source-facts';
import type { ProviderDiffResult } from '../providers/types';

const D03 = 'd03aadd2c95a94ecbe229896b29c9dcda009a916';
const HEAD = '9a313da019d2ee3dd1e908cf4b0e52fffa945d6a';
const BASE = '20cba59eb1f434bb6f4bf5701b189a1eb6754409';
const OLD_BASE = '311fea1fc538c493e1f1fc92232024455d7c4388';
const OLD_START = '6794d2ce9d2787c30f2d685a2a1bcf13dd0bbfe8';
const PATHS = ['app/graphql/mutations/boards/issues/issue_move_list.rb', 'app/services/boards/base_item_move_service.rb', 'spec/graphql/mutations/boards/issues/issue_move_list_spec.rb'];
const ANCHORS = ['2384b693797296a4feb5371e4c1a775b92dbbeb4', '0b7f55307397ee478e05e1bf391f6d7e4b6aa606', '1368db605e5982dfe6a6596a37b7cb054d48d61d'];
const running: GitLabNativeWhitespace[] = [];
let number = 266334;

function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing native fixture');return value; }

// Public294 native tuples/anchors, reduced to structural fields. Unique MRs isolate per-document unit history.
function fixture() {
  const mr = String(number++);const base = `https://gitlab.com/gitlab-org/gitlab/-/merge_requests/${mr}`;
  window.location.href = `${base}/diffs?diff_id=2158520123`;
  document.body.dataset.projectId = '278964';document.body.dataset.projectFullPath = 'gitlab-org/gitlab';
  document.body.innerHTML = `<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a><div id="js-vue-mr-discussions" data-current-user-data="null"></div><article data-rapid-diffs>
    <header class="rd-app-header" aria-label="View controls"><div class="gl-new-dropdown" aria-label="Preferences">
    <button type="button" class="js-show-diff-settings" data-testid="base-dropdown-toggle" role="combobox" aria-expanded="false">Preferences</button>
    <div data-testid="base-dropdown-menu"><input id="show" type="checkbox" value="true" data-testid="show-whitespace"><label for="show">Show whitespace changes</label>
    <input id="single" type="checkbox" value="true" data-testid="file-by-file"><label for="single">Show one file at a time</label></div></div></header>
    <div data-diffs-overlay></div><div data-list-loading hidden="hidden"></div><div data-diffs-list-alert></div><div data-diffs-list></div></article>`;
  const root = required(document.querySelector<HTMLElement>('[data-rapid-diffs]'));
  const app = { iid: mr, project_path: 'gitlab-org/gitlab', mr_path: new URL(base).pathname, reload_stream_url: `${new URL(base).pathname}/diffs_stream?diff_id=2158520123`, diff_view_type: 'inline', is_fork: false, file_by_file_mode: false, show_whitespace: false, versions: {
    source_versions: [{ id: 2158520123, selected: true, head_sha: D03, is_merge_head: false }],
    target_versions: [{ id: 2158520123, selected: true, head_sha: D03, start_sha: OLD_START, is_merge_head: false }],
  } };
  root.setAttribute('data-app-data', JSON.stringify(app));
  const field = required(document.querySelector<HTMLInputElement>('#show'));
  const list = required(root.querySelector<HTMLElement>('[data-diffs-list]'));
  const overlay = required(root.querySelector<HTMLElement>('[data-diffs-overlay]'));
  const loading = required(root.querySelector<HTMLElement>('[data-list-loading]'));
  const alert = required(root.querySelector<HTMLElement>('[data-diffs-list-alert]'));
  function file(index: number, head = D03, start = OLD_START, oldBase = OLD_BASE): HTMLElement {
    const node = document.createElement('diff-file');node.id = ANCHORS[index]!;
    node.setAttribute('data-file-data', JSON.stringify({ new_path: PATHS[index], diff_refs: { head_sha: head, start_sha: start, base_sha: oldBase },
      blob_raw_path: `/gitlab-org/gitlab/-/raw/${head}/${PATHS[index]}`, diff_lines_path: `/gitlab-org/gitlab/-/blob/${head}/${PATHS[index]}/diff_lines` }));
    const viewed = document.createElement('input');viewed.type = 'checkbox';viewed.disabled = true;viewed.setAttribute('data-viewed-checkbox', '');
    node.append(viewed, document.createElement('diff-file-mounted'));return node;
  }
  list.append(...PATHS.map((_, index) => file(index)));
  const page = required(describeGitLabPage(new URL(window.location.href), document));
  const sourceFacts = required(providerDiffSourceFacts(page, { kind: 'gitlab-review', headSha: D03, baseSha: OLD_BASE, diffId: '2158520123', commitId: null, projectPath: 'gitlab-org/gitlab',
    target: { id: '2160786615', headSha: HEAD, startSha: BASE, mergeHead: true } }, PATHS.map((path) => ({ path, newPath: path }))));
  const result: ProviderDiffResult = { complete: true, revision: 'unchanged-raw-comparison', sourceFacts, files: PATHS.map((path) => ({ path, additions: 1, deletions: 0, status: 'modified' })) };
  const changed = vi.fn();const choice = vi.fn();
  // Trusted-event dependency is a unit-only seam. Production uses event.isTrusted.
  const session = new GitLabNativeWhitespace(document, changed, choice, () => true);running.push(session);
  const input = (show = true) => { field.checked = show;field.dispatchEvent(new Event('click', { bubbles: true }));field.dispatchEvent(new Event('change', { bubbles: true })); };
  const cycle = () => {
    overlay.setAttribute('data-loading', 'true');
    list.replaceChildren();overlay.removeAttribute('data-loading');loading.removeAttribute('hidden');
    list.append(...PATHS.map((_, index) => file(index, HEAD, BASE, BASE)));
    loading.setAttribute('hidden', 'hidden');
  };
  return { root, app, field, list, overlay, loading, alert, page, result, changed, choice, session, input, cycle, file };
}

afterEach(() => { for (const session of running.splice(0)) session.stop();document.body.replaceChildren();vi.restoreAllMocks(); });

describe('native whitespace intent and current rendered source', () => {
  it('accepts the actual294 frozen bootstrap / coherent current native tuple without changing raw facts', () => {
    const f = fixture();f.session.update(f.page, f.result);
    const before = JSON.stringify(f.result);const originalApp = f.root.getAttribute('data-app-data');
    f.input();expect(f.choice).toHaveBeenCalledWith(new URL(document.URL), true);
    expect(f.session.suspended()).toBe(true);
    f.cycle();
    const rendered = required(readGitLabRenderedView(document, f.root));
    expect(rendered.files).toHaveLength(3);expect(rendered.files.every((file) => file.headSha === HEAD && file.startSha === BASE && file.baseSha === BASE)).toBe(true);
    expect(f.root.getAttribute('data-app-data')).toBe(originalApp);
    expect(f.session.suspended()).toBe(false);
    const view = required(readGitLabDiff(document));
    const frame = required(view.readNewSourceFrame?.());
    const source = frame.read(view.entries[0]!);
    expect(source?.comparison).toMatchObject({ kind: 'gitlab-native-reload', sourceId: '2158520123', sourceHeadSha: D03 });
    expect(source?.comparison).not.toHaveProperty('target');
    const context = providerOutlineContext(f.page, f.result, view);
    expect([...context.newSources.values()].every((source) => source.headSha === HEAD)).toBe(true);
    expect(context.newSources.size).toBe(3);expect(context.commentCoordinateMismatches?.size).toBe(3);
    expect(JSON.stringify(f.result)).toBe(before);
    f.input(false);expect(frame.current()).toBe(false);
  });

  it('retains qualified reader intent before inventory is available but never reconstructs a missed epoch', () => {
    const f = fixture();f.session.update(f.page, null);f.input();f.cycle();f.session.update(f.page, f.result);
    expect(f.choice).toHaveBeenCalledTimes(1);expect(f.session.sourceUnavailable()).toBe(true);
    expect(readGitLabRenderedView(document, f.root)).toBeNull();
  });

  it('retires already captured initial-source callbacks synchronously on intent while preserving the initial immutable alias', () => {
    const f = fixture();f.session.update(f.page, f.result);
    const view = required(readGitLabDiff(document));const frame = required(view.readNewSourceFrame?.());
    expect(frame.current()).toBe(true);expect(frame.read(view.entries[0]!)?.comparison).toMatchObject({ kind: 'gitlab-review', target: { id: '2158520123', headSha: D03, mergeHead: false } });
    expect(providerOutlineContext(f.page, f.result, view).newSources.size).toBe(3);
    f.input();expect(frame.current()).toBe(false);expect(frame.read(view.entries[0]!)).toBeNull();
    f.cycle();expect(frame.current()).toBe(false);expect(frame.read(required(readGitLabDiff(document)).entries[0]!)).toBeNull();
    f.session.stop();expect(frame.current()).toBe(false);expect(frame.read(view.entries[0]!)).toBeNull();
  });

  it('keeps initial read/current consistent after route departure with old native nodes still connected', () => {
    const f = fixture();f.session.update(f.page, f.result);const view = required(readGitLabDiff(document));const frame = required(view.readNewSourceFrame?.());
    expect(frame.current()).toBe(true);expect(frame.read(view.entries[0]!)).not.toBeNull();
    f.input();const originalUrl = document.URL;window.location.href = 'https://gitlab.com/another/project/-/commit/' + D03;
    f.session.update(null, null);expect(view.entries[0]!.root.isConnected).toBe(true);expect(frame.current()).toBe(false);expect(frame.read(view.entries[0]!)).toBeNull();
    window.location.href = originalUrl;f.session.update(f.page, f.result);expect(frame.current()).toBe(false);expect(frame.read(view.entries[0]!)).toBeNull();
  });

  it('allows ordinary initial file hydration and later complete acquisition without manufacturing a mode', () => {
    const f = fixture();f.list.replaceChildren();f.session.update(f.page, null);
    expect(f.session.suspended()).toBe(false);expect(readGitLabRenderedView(document, f.root)).toBeUndefined();
    f.list.append(...PATHS.map((_, index) => f.file(index)));f.session.update(f.page, f.result);
    f.input();f.cycle();expect(f.session.suspended()).toBe(false);
  });

  it.each(['head', 'base', 'start', 'path', 'resource', 'duplicate', 'missing', 'unmounted', 'old'])('refuses %s source incoherence while preserving reader intent', (kind) => {
    const f = fixture();f.session.update(f.page, f.result);const original = [...f.list.children];f.input();f.cycle();
    const file = required(f.list.firstElementChild);const data: unknown = JSON.parse(file.getAttribute('data-file-data')!);
    if (typeof data !== 'object' || data === null || !('diff_refs' in data)) throw new Error('Fixture data');
    if (kind === 'head' || kind === 'base' || kind === 'start') {
      const parsed: unknown = JSON.parse(file.getAttribute('data-file-data')!);
      if (!record(parsed) || !record(parsed.diff_refs)) throw new Error('Fixture refs');
      parsed.diff_refs[`${kind}_sha`] = D03;file.setAttribute('data-file-data', JSON.stringify(parsed));
    }
    if (kind === 'path') file.setAttribute('data-file-data', JSON.stringify({ new_path: 'unknown', diff_refs: { base_sha: BASE, start_sha: BASE, head_sha: HEAD } }));
    if (kind === 'resource') file.setAttribute('data-file-data', file.getAttribute('data-file-data')!.replace('/raw/', '/wrong/'));
    if (kind === 'duplicate') f.list.append(file.cloneNode(true));
    if (kind === 'missing') file.remove();
    if (kind === 'unmounted') file.lastElementChild?.remove();
    if (kind === 'old') f.list.replaceChildren(...original);
    expect(f.session.sourceUnavailable()).toBe(true);expect(readGitLabRenderedView(document, f.root)).toBeNull();expect(f.choice).toHaveBeenCalledTimes(1);
  });

  it.each(['overlap', 'prior-busy', 'alert', 'owner', 'bootstrap', 'actor', 'property', 'marker', 'dialog', 'form'])('refuses %s even if final DOM looks usable', (kind) => {
    const f = fixture();f.session.update(f.page, f.result);
    if (kind === 'prior-busy') f.overlay.setAttribute('data-loading', 'true');
    f.input();
    if (kind === 'overlap') f.input(false);
    f.cycle();
    if (kind === 'alert') { const alert = document.createElement('span');f.alert.append(alert);alert.remove(); }
    if (kind === 'owner') { const parent = f.root.parentNode!;f.root.remove();parent.appendChild(f.root); }
    if (kind === 'bootstrap') { const original = f.root.getAttribute('data-app-data')!;f.root.setAttribute('data-app-data', '{}');f.root.setAttribute('data-app-data', original); }
    if (kind === 'actor') { const actor = required(document.querySelector('#js-vue-mr-discussions'));actor.setAttribute('data-current-user-data', '{"id":123}');actor.setAttribute('data-current-user-data', 'null'); }
    if (kind === 'property') f.field.checked = false;
    if (kind === 'marker') { const clone = f.loading.cloneNode(true);f.loading.parentNode!.append(clone);clone.parentNode?.removeChild(clone); }
    if (kind === 'dialog') { const node = document.createElement('dialog');document.body.append(node);node.remove(); }
    if (kind === 'form') { const node = document.createElement('form');f.field.parentElement?.append(node);node.remove(); }
    expect(f.session.sourceUnavailable()).toBe(true);expect(readGitLabRenderedView(document, f.root)).toBeNull();
  });

  it('revalidates a ready lease before cached source reuse and does not reopen it after observer recreation', () => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();
    const frame = required(required(readGitLabDiff(document)).readNewSourceFrame?.());expect(frame.current()).toBe(true);
    f.field.checked = false;expect(frame.current()).toBe(false);
    f.field.checked = true;expect(frame.current()).toBe(false);expect(f.session.sourceUnavailable()).toBe(true);
    f.session.stop();const next = new GitLabNativeWhitespace(document, f.changed, f.choice);running.push(next);
    next.update(f.page, f.result);expect(next.sourceUnavailable()).toBe(true);expect(readGitLabRenderedView(document, f.root)).toBeNull();
  });

  it('does not require an API target match or promote a later API target into native facts', () => {
    const f = fixture();const facts = required(f.result.sourceFacts);
    if (facts.comparison.kind !== 'gitlab-review') throw new Error('Fixture comparison');
    const result = { ...f.result, sourceFacts: { ...facts, comparison: { ...facts.comparison, target: null } } };
    f.session.update(f.page, result);f.input();f.cycle();
    const context = providerOutlineContext(f.page, result, required(readGitLabDiff(document)));
    expect(context.newSources.size).toBe(3);expect([...context.newSources.values()].every((source) => source.headSha === HEAD)).toBe(true);
    const advanced = { ...result, sourceFacts: { ...facts, comparison: { ...facts.comparison, target: { id: '2160999999', headSha: D03, startSha: OLD_START, mergeHead: true } } } };
    const next = providerOutlineContext(f.page, advanced, required(readGitLabDiff(document)));
    expect(next.newSources.size).toBe(3);expect([...next.newSources.values()].every((source) => source.headSha === HEAD)).toBe(true);
    expect(advanced.sourceFacts.comparison.target.headSha).toBe(D03);
  });

  it('never synthesizes new-side paths for deleted or unsupported inventory', () => {
    const f = fixture();f.session.update(f.page, { ...f.result, files: f.result.files.map((file, index) => index === 0 ? { ...file, status: 'deleted' } : file) });
    f.input();f.cycle();expect(f.choice).toHaveBeenCalledTimes(1);expect(f.session.sourceUnavailable()).toBe(true);
  });

  it('requires genuine production trusted events without the unit-only dependency', () => {
    const f = fixture();f.session.stop();const next = new GitLabNativeWhitespace(document, f.changed, f.choice);running.push(next);
    next.update(f.page, f.result);f.input();expect(f.choice).not.toHaveBeenCalled();expect(next.suspended()).toBe(false);
  });

  it('retains the original click through the real Chrome microtask-before-change order, but expires at the next task', async () => {
    const f = fixture();f.session.update(f.page, f.result);
    f.field.checked = true;f.field.dispatchEvent(new Event('click', { bubbles: true }));await Promise.resolve();
    f.field.dispatchEvent(new Event('change', { bubbles: true }));expect(f.choice).toHaveBeenCalledTimes(1);
    f.cycle();expect(f.session.sourceUnavailable()).toBe(false);
    f.field.checked = false;f.field.dispatchEvent(new Event('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.field.dispatchEvent(new Event('change', { bubbles: true }));expect(f.choice).toHaveBeenCalledTimes(1);
  });

  it.each(['field-outside-list', 'other-file-removed', 'valid-anchor-drift'])('self-validates a retained read callback after %s, without requiring a caller current() check', (kind) => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();
    const view = required(readGitLabDiff(document));const frame = required(view.readNewSourceFrame?.());
    if (kind === 'field-outside-list') f.root.append(...f.list.children);
    else if (kind === 'valid-anchor-drift') view.entries[0]!.root.id = 'f'.repeat(40);
    else f.list.lastElementChild?.remove();
    expect(frame.read(view.entries[0]!)).toBeNull();expect(f.session.sourceUnavailable()).toBe(true);expect(frame.current()).toBe(false);
  });

  it.each([true, false])('preserves default-route intent with reload source pinned=%s, granting only proven source authority', (pinned) => {
    const f = fixture();window.location.href = document.URL.split('?')[0]!;
    f.root.setAttribute('data-app-data', JSON.stringify({ ...f.app, reload_stream_url: `${f.app.mr_path}/diffs_stream${pinned ? '?diff_id=2158520123' : ''}` }));
    const page = required(describeGitLabPage(new URL(document.URL), document));
    const facts = required(f.result.sourceFacts);
    const result = { ...f.result, sourceFacts: { ...facts, subject: { ...facts.subject, version: page.version } } };
    f.session.update(page, result);f.input();expect(f.choice).toHaveBeenCalledTimes(1);f.cycle();
    expect(f.session.sourceUnavailable()).toBe(!pinned);
  });

  it('ignores a change with no qualified gesture and refuses a competing native view choice even if restored in the same turn', () => {
    const f = fixture();f.session.update(f.page, f.result);
    f.field.checked = true;f.field.dispatchEvent(new Event('change', { bubbles: true }));expect(f.choice).not.toHaveBeenCalled();
    f.input();const other = required(document.querySelector<HTMLInputElement>('#single'));
    other.checked = true;other.dispatchEvent(new Event('change', { bubbles: true }));other.checked = false;other.dispatchEvent(new Event('change', { bubbles: true }));
    f.cycle();expect(f.session.sourceUnavailable()).toBe(true);
  });

  it('supports a second observed same-owner restore epoch and invalidates the old source key', () => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();
    const first = required(readGitLabRenderedView(document, f.root));
    f.input(false);expect(f.session.suspended()).toBe(true);f.cycle();
    const next = required(readGitLabRenderedView(document, f.root));
    expect(next.showWhitespace).toBe(false);expect(next.key).not.toBe(first.key);expect(f.choice).toHaveBeenCalledTimes(2);
  });

  it('never restores an invalidated source lease when master/clear-style updates deliver the same raw inventory again', () => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();expect(f.session.sourceUnavailable()).toBe(false);
    const original = f.root.getAttribute('data-app-data')!;f.root.setAttribute('data-app-data', '{}');f.root.setAttribute('data-app-data', original);
    expect(f.session.sourceUnavailable()).toBe(true);f.session.update(f.page, null);f.session.update(f.page, f.result);
    expect(f.session.sourceUnavailable()).toBe(true);expect(f.session.suspended()).toBe(false);
  });

  it('can retain a fresh original gesture after observer recreation without reviving invalidated source authority', () => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();expect(f.session.sourceUnavailable()).toBe(false);
    f.session.stop();const next = new GitLabNativeWhitespace(document, f.changed, f.choice, () => true);running.push(next);
    next.update(f.page, f.result);f.input(false);expect(f.choice).toHaveBeenLastCalledWith(new URL(document.URL), false);
    f.cycle();expect(next.sourceUnavailable()).toBe(true);expect(readGitLabRenderedView(document, f.root)).toBeNull();
  });

  it('declines ambiguous native scope and authored control replicas without collecting an intent', () => {
    const f = fixture();const replica = required(f.field.closest('[aria-label="Preferences"]')).cloneNode(true);
    if (!(replica instanceof HTMLElement)) throw new Error('Fixture clone');
    for (const label of replica.querySelectorAll<HTMLLabelElement>('label[for]')) label.htmlFor += '-authored';
    for (const field of replica.querySelectorAll('input')) field.id += '-authored';
    const wrapper = document.createElement('div');wrapper.className = 'note-text';wrapper.append(replica);document.body.append(wrapper);
    f.session.update(f.page, f.result);const duplicate = f.root.cloneNode(true);document.body.append(duplicate);
    f.input();expect(f.choice).not.toHaveBeenCalled();expect(f.session.sourceUnavailable()).toBe(true);
  });

  it('does not suspend an unrelated route or reuse the prior document-view source on returning', () => {
    const f = fixture();f.session.update(f.page, f.result);f.input();f.cycle();expect(f.session.sourceUnavailable()).toBe(false);
    const old = document.URL;window.location.href = 'https://gitlab.com/another/project/-/commit/' + D03;
    f.session.update(null, null);expect(f.session.suspended()).toBe(false);expect(f.session.sourceUnavailable()).toBe(false);
    window.location.href = old;f.session.update(f.page, f.result);expect(f.session.sourceUnavailable()).toBe(true);
  });

  it('keeps native source nodes and checked/disabled Viewed values untouched through intent, reload and lease reads', () => {
    const f = fixture();const fetch = vi.fn();vi.stubGlobal('fetch', fetch);const click = vi.spyOn(HTMLElement.prototype, 'click');
    f.session.update(f.page, f.result);f.input();f.cycle();
    const rows = [...f.list.children];const before = f.root.outerHTML;const viewed = [...f.list.querySelectorAll<HTMLInputElement>('input[data-viewed-checkbox]')];
    expect(f.session.sourceUnavailable()).toBe(false);const frame = required(required(readGitLabDiff(document)).readNewSourceFrame?.());expect(frame.current()).toBe(true);
    expect(f.root.outerHTML).toBe(before);expect([...f.list.children]).toEqual(rows);expect(viewed.every((field) => field.disabled && !field.checked)).toBe(true);expect([...f.list.querySelectorAll('input[data-viewed-checkbox]')]).toEqual(viewed);
    expect(click).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
});
