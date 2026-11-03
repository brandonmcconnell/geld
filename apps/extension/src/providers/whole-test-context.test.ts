// @vitest-environment happy-dom
import { DEFAULT_SETTINGS } from '@geld/core';
import type { TestFold } from '@geld/core';
import { describeGitLabPage } from '../gitlab/page';
import { readGitLabDiff } from '../gitlab/diff';
import { createGitLabWholeTestAdapter } from '../gitlab/whole-test-context';
import { ProviderHttpAdmission } from './http-admission';
import { providerDiffSourceFacts, providerOutlineContext } from './source-facts';
import { ProviderWholeTestContext, providerMissingNewLines, providerWholeSourceAgrees } from './whole-test-context';
import type { ProviderDiffResult, ProviderDiffView } from './types';
import type { ProviderWholeSourceReader } from './whole-source';

const H = 'a'.repeat(40), B = 'b'.repeat(40), S = 'c'.repeat(40), PATH = 'spec/file.test.ts';
const source = ["it('whole declaration', () => {", '  first();', '  second();', '});', 'export const next = 1;'];
const managers: ProviderWholeTestContext[] = [];
function deferred<T>() { let resolve!: (value:T)=>void;const promise = new Promise<T>((done) => { resolve = done; });return { promise, resolve }; }
function fixture() {
  window.location.href = 'https://gitlab.com/group/repo/-/merge_requests/1/diffs?diff_id=101';
  const row = (n:number, text = source[n - 1]!) => `<tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="old"><a class="rd-line-link" href="#line" data-line-number="${n}"></a></td><td class="rd-line-number" data-position="new"><a class="rd-line-link" href="#line" data-line-number="${n}"></a></td><td class="rd-line-content"><pre class="rd-line-text">${text}\n</pre></td></tr>`;
  const appData = { project_path: 'group/repo', mr_path: '/group/repo/-/merge_requests/1', is_fork: 'false', versions: { source_versions: [{ id:101, selected:true, head_sha:H, base_sha:B, start_sha:S }], target_versions: [{ id:101, selected:true, head_sha:H, start_sha:S, is_merge_head:false }] } };
  const fileData = { new_path:PATH, old_path:PATH, diff_refs:{ base_sha:B, head_sha:H, start_sha:S }, blob_raw_path:`/group/repo/-/raw/${H}/${PATH}`, diff_lines_path:`/group/repo/-/blob/${H}/${PATH}/diff_lines` };
  document.body.innerHTML = `<article data-rapid-diffs><div data-diffs-list><diff-file><header data-testid="rd-diff-file-header" aria-label="Diff file controls"><div class="rd-diff-file-info"><input type="checkbox" data-viewed-checkbox></div></header><details data-file-body open><table class="rd-text-view-root"><tbody class="rd-text-view-content"><tr class="rd-hunk-header" data-hunk-header><td><button data-click="expandLines" data-expand-direction="up">Show lines</button></td></tr>${row(4)}${row(5)}</tbody></table></details></diff-file></div></article>`;
  const app = document.querySelector<HTMLElement>('article')!, root = document.querySelector<HTMLElement>('diff-file')!;
  app.setAttribute('data-app-data', JSON.stringify(appData));root.setAttribute('data-file-data', JSON.stringify(fileData));
  const page = describeGitLabPage(new URL(window.location.href), document)!;
  const facts = providerDiffSourceFacts(page, { kind:'gitlab-review', headSha:H, baseSha:B, diffId:'101', commitId:null, projectPath:'group/repo', target:{ id:'101', headSha:H, startSha:S, mergeHead:false } }, [{ path:PATH, newPath:PATH }])!;
  const result:ProviderDiffResult = { files:[{ path:PATH, additions:0, deletions:0, status:'modified' }], revision:'selected', complete:true, sourceFacts:facts };
  const native = createGitLabWholeTestAdapter(new ProviderHttpAdmission(undefined, 0));
  const read = vi.fn<ProviderWholeSourceReader>(async () => ({ lines:source, bytes:source.join('\n').length }));
  const step = vi.fn(native.nextContext);const feature = { ...native, readSource:read, nextContext:step };
  const refresh = vi.fn();let latestView:ProviderDiffView|null = null;
  const readView=vi.fn((doc:Document) => latestView ?? readGitLabDiff(doc));
  const adapter = { id:'gitlab' as const, describe:describeGitLabPage, headerTargets:()=>[], listRows:()=>[], fetchDiff:async()=>result, readDiff:readView };
  const manager = new ProviderWholeTestContext(adapter, feature, refresh);managers.push(manager);
  const update = () => { const view = readGitLabDiff(document)!;const context = providerOutlineContext(page, result, view);manager.update(page, result, view, DEFAULT_SETTINGS, context);manager.mount(view.entries[0]!);return view.entries[0]!; };
  const entry = update();
  const request = async () => { const files = Reflect.get(manager,'files') as Map<HTMLElement,unknown>;await Reflect.apply(Reflect.get(manager,'request'), manager, [files.get(root)]); };
  const fold:TestFold = { id:'R1', kind:'test', title:'whole declaration', status:'unchanged', headKey:'R1', start:1, headingKeys:['R1'], bodyKeys:['R2','R3','R4'], additions:0, deletions:0 };
  return { root, app, appData, fileData, entry, manager, read, refresh, update, request, step, row, fold, readView, holdView:(view:ProviderDiffView) => { latestView=view; } };
}
afterEach(() => { for(const manager of managers.splice(0)) manager.destroy();vi.useRealTimers();vi.restoreAllMocks();document.body.replaceChildren(); });
it('requires explicit real input: default-on render and script clicks never acquire source', async () => {
  const f=fixture();expect(f.read).not.toHaveBeenCalled();f.root.querySelector<HTMLButtonElement>('[data-geld-test-boundaries]')!.click();await Promise.resolve();expect(f.read).not.toHaveBeenCalled();
  await f.request();expect(f.read).toHaveBeenCalledTimes(1);expect(f.manager.source(f.entry)?.lines).toEqual(source);expect(f.refresh).toHaveBeenCalledTimes(1);
});
it('rebuilds authority at dispatch rather than trusting a held frame that still says current', async () => {
  const f=fixture();const view = readGitLabDiff(document)!;const frame = view.readNewSourceFrame!()!;f.holdView({ ...view, readNewSourceFrame:() => ({ ...frame, current:() => true }) });
  f.root.setAttribute('data-file-data',JSON.stringify({ ...f.fileData, diff_refs:{ ...f.fileData.diff_refs, head_sha:'d'.repeat(40) } }));
  await f.request();expect(f.read).not.toHaveBeenCalled();expect(f.manager.source(f.entry)).toBeNull();
});
it('rebuilds global native page selection even if an earlier batched frame still claims current', async () => {
  const f=fixture(), earlier=readGitLabDiff(document)!.readNewSourceFrame!()!;
  const held={...earlier,current:()=>true};expect(held.read(f.entry)).not.toBeNull();
  f.app.setAttribute('data-app-data',JSON.stringify({...f.appData,is_fork:'true'}));expect(held.current()).toBe(true);
  await f.request();expect(f.readView).toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.manager.source(f.entry)).toBeNull();
});
it.each(['head','route','filtered','collapsed','detached','background'] as const)('rejects completion after %s drift and never publishes stale boundaries', async (drift) => {
  const f=fixture(), pending=deferred<{lines:readonly string[];bytes:number}>();f.read.mockReturnValue(pending.promise);const work=f.request();await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
  if(drift==='head') f.root.setAttribute('data-file-data',JSON.stringify({ ...f.fileData, diff_refs:{ ...f.fileData.diff_refs, head_sha:'d'.repeat(40) } }));
  if(drift==='route') window.location.href=window.location.href.replace('/1/diffs','/2/diffs');
  if(drift==='filtered') f.holdView({ ...readGitLabDiff(document)!, filteredPaths:new Set([PATH]) });
  if(drift==='collapsed') f.root.querySelector('details')!.removeAttribute('open');
  if(drift==='detached') f.root.remove();
  if(drift==='background') vi.spyOn(document,'hidden','get').mockReturnValue(true);
  pending.resolve({lines:source,bytes:source.join('\n').length});await work;expect(f.manager.source(f.entry)).toBeNull();expect(f.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed');
});
it('aborts the last retired demand, and a remounted native file never inherits an automatic retry', async () => {
  const f=fixture(), pending=deferred<{lines:readonly string[];bytes:number}>();f.read.mockReturnValue(pending.promise);const work=f.request();await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
  const signal=f.read.mock.calls[0]![1] as AbortSignal;f.manager.retain(new Set());await work;expect(signal.aborted).toBe(true);expect(f.root.querySelector('[data-geld-test-boundaries]')).toBeNull();
  f.update();await f.request();expect(f.read).toHaveBeenCalledTimes(1);expect(f.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed');
});
it('refuses visible-text disagreement and never falls back to different or guessed whole source', async () => {
  const f=fixture();f.read.mockResolvedValue({lines:['different'],bytes:9});await f.request();expect(f.manager.source(f.entry)).toBeNull();expect(f.root.querySelector('[data-geld-test-boundaries]')?.getAttribute('data-status')).toBe('failed');expect(f.step).not.toHaveBeenCalled();
});
it('expands the actual original native control only until every required new line is mounted', async () => {
  const f=fixture();await f.request();const native=f.root.querySelector<HTMLButtonElement>('[data-click="expandLines"]')!, viewed=f.root.querySelector<HTMLInputElement>('input')!;const original=f.root.querySelectorAll('tr')[1]!;const text=original.textContent;
  native.addEventListener('click',(event) => { event.preventDefault();const body=document.createElement('tbody');body.className='rd-text-view-content';body.innerHTML=[1,2,3].map((n)=>f.row(n)).join('');native.closest('tbody')!.before(body);native.closest('tr')!.remove(); });
  const listener=vi.fn();native.addEventListener('click',listener);f.manager.reveal(f.entry,f.fold,()=>true);expect(listener).toHaveBeenCalledTimes(1);expect(f.entry.readLines!().map((line)=>[line.newLine,line.newText])).toEqual(source.map((text,i)=>[i+1,text]));expect(f.manager.source(f.entry)).not.toBeNull();await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(2));
  expect(listener).toHaveBeenCalledTimes(1);expect(providerMissingNewLines(f.fold,f.entry.readLines!())).toEqual([]);expect(original.isConnected).toBe(true);expect(original.textContent).toBe(text);expect(viewed.checked).toBe(false);
});
it.each(['disabled', 'source mismatch', 'revision'] as const)('retains a ready source after its last gap closes but clears it after %s', async change => {
  const f=fixture();await f.request();const button=f.root.querySelector('[data-geld-test-boundaries]');
  f.root.querySelector('[data-hunk-header]')!.remove();f.update();
  expect(f.root.querySelector('[data-geld-test-boundaries]')).toBe(button);expect(f.manager.source(f.entry)?.lines).toEqual(source);expect(f.read).toHaveBeenCalledTimes(1);
  if(change==='source mismatch') { f.root.querySelector('.rd-line-text')!.textContent='different\n';f.update(); }
  if(change==='revision') { f.root.setAttribute('data-file-data',JSON.stringify({ ...f.fileData,diff_refs:{...f.fileData.diff_refs,head_sha:'d'.repeat(40)} }));f.update(); }
  if(change==='disabled') { const view=readGitLabDiff(document)!,page=describeGitLabPage(new URL(document.URL),document)!;const context=providerOutlineContext(page,{files:[],revision:'disabled',complete:false},view);f.manager.update(page,{files:[],revision:'disabled',complete:false},view,{...DEFAULT_SETTINGS,enabled:false},context);f.manager.mount(f.entry); }
  expect(f.root.querySelector('[data-geld-test-boundaries]')).toBeNull();expect(f.manager.source(f.entry)).toBeNull();expect(f.read).toHaveBeenCalledTimes(1);
});
it('rebuilds the source frame immediately before native activation, not only before fetching', async () => {
  const f=fixture();await f.request();const click=vi.fn();f.root.querySelector('[data-click="expandLines"]')!.addEventListener('click',click);
  f.step.mockImplementation((entry,missing) => { const step=createGitLabWholeTestAdapter(new ProviderHttpAdmission()).nextContext(entry,missing);f.app.setAttribute('data-app-data',JSON.stringify({ ...f.appData, is_fork:'true' }));return step; });
  f.manager.reveal(f.entry,f.fold,()=>true);await Promise.resolve();expect(click).not.toHaveBeenCalled();
});
it('stops without automatic retry on a native control that makes no monotonic progress', async () => {
  vi.useFakeTimers();const f=fixture();await f.request();const click=vi.fn();f.root.querySelector('[data-click="expandLines"]')!.addEventListener('click',click);
  f.manager.reveal(f.entry,f.fold,()=>true);await vi.advanceTimersByTimeAsync(8100);expect(click).toHaveBeenCalledTimes(1);expect(f.refresh).toHaveBeenCalledTimes(1);
});
it('bounds partial native expansion to four progressing original activations and preserves shown scope', async () => {
  vi.useFakeTimers();const f=fixture();const extended=[...source,...Array.from({length:10},(_,i)=>`line${i+6}`)];f.read.mockResolvedValue({lines:extended,bytes:extended.join('\n').length});await f.request();let number=6;
  const activate=vi.fn(()=>{ const body=document.createElement('tbody');body.className='rd-text-view-content';body.innerHTML=f.row(number,`line${number}`);f.root.querySelector('table')!.append(body);number++; });
  f.step.mockImplementation(()=>({current:()=>true,activate}));const fold={...f.fold,headKey:'R6',start:6,headingKeys:['R6'],bodyKeys:Array.from({length:9},(_,i)=>`R${i+7}`)};
  f.manager.reveal(f.entry,fold,()=>true);await vi.advanceTimersByTimeAsync(30_100);expect(activate).toHaveBeenCalledTimes(4);expect(providerMissingNewLines(fold,f.entry.readLines!())).toEqual([10,11,12,13,14,15]);
});
it('checks duplicate/invalid new coordinates and never mistakes old-only rows for new extents', () => {
  const f=fixture(), shown=f.entry.readLines!();expect(providerWholeSourceAgrees(source,shown)).toBe(true);
  expect(providerWholeSourceAgrees(source,[...shown,{...shown[1]!,newLine:4,newText:'wrong'}])).toBe(false);
  expect(providerWholeSourceAgrees(source,shown.map((line)=>({...line,newLine:null})))).toBe(false);
  expect(providerMissingNewLines(f.fold,shown)).toEqual([1,2,3]);
});

async function focusOperation() {
  const f = fixture();await f.request();const control = document.createElement('button');control.dataset.geldUi = '';f.root.append(control);control.focus();let ownerCurrent = true;
  const native = f.root.querySelector<HTMLButtonElement>('[data-expand-direction="up"]')!;native.addEventListener('click', (event) => event.preventDefault());
  const insert = (number = 3): HTMLAnchorElement => { const holder = document.createElement('tbody');holder.className = 'rd-text-view-content';holder.innerHTML = [1, 2, number].map((n) => f.row(n)).join('');native.closest('tbody')!.before(holder);return holder.querySelector<HTMLAnchorElement>(`.rd-line-number[data-position="old"] a[data-line-number="${number}"]`)!; };
  return { ...f, control, native, insert, owner: { current: () => ownerCurrent ? control : null }, revoke: () => { ownerCurrent = false; } };
}
function unitReaderInput(type: 'keydown' | 'pointerdown'): void { const event = type === 'keydown' ? new KeyboardEvent(type, { key: 'Tab', bubbles: true }) : new MouseEvent(type, { bubbles: true });Object.defineProperty(event, 'isTrusted', { value: true });document.dispatchEvent(event); }
it('hands newly inserted native OLD3 focus back only through the same row immutable NEW3 and current focused owner', async () => {
  const f = await focusOperation();let target: HTMLAnchorElement | null = null;const focus = vi.spyOn(f.control, 'focus');f.native.addEventListener('click', () => { target = f.insert();target.focus(); });
  f.manager.reveal(f.entry, f.fold, () => true, f.owner);expect(target).not.toBeNull();expect(document.activeElement).toBe(f.control);expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(2));expect(f.manager.source(f.entry)).not.toBeNull();
});
it('keeps the bounded listener through asynchronous native insertion/focus and removes it when that step completes', async () => {
  vi.useFakeTimers();const f = await focusOperation(), focus = vi.spyOn(f.control, 'focus');let later: HTMLAnchorElement | null = null;
  f.native.addEventListener('click', () => { setTimeout(() => { later = f.insert();later.focus(); }, 30); });f.manager.reveal(f.entry, f.fold, () => true, f.owner);await vi.advanceTimersByTimeAsync(80);expect(document.activeElement).toBe(f.control);expect(focus).toHaveBeenCalledOnce();later!.focus();expect(document.activeElement).toBe(later);expect(focus).toHaveBeenCalledOnce();
});
for (const mode of ['existing link', 'wrong body', 'wrong line', 'old-only row', 'stale head', 'stale route', 'stale control', 'closed fold', 'unrelated focus', 'reader key', 'reader pointer', 'BODY only'] as const) it(`never hands context focus back after ${mode}`, async () => {
  const f = await focusOperation(), focus = vi.spyOn(f.control, 'focus');let open = true;
  f.native.addEventListener('click', () => {
    if (mode === 'reader key') unitReaderInput('keydown');if (mode === 'reader pointer') unitReaderInput('pointerdown');
    if (mode === 'unrelated focus') { const other = document.createElement('button');document.body.append(other);other.focus(); }
    if (mode === 'stale head') f.root.dataset.fileData = JSON.stringify({ ...f.fileData, diff_refs: { ...f.fileData.diff_refs, head_sha: 'd'.repeat(40) } });
    if (mode === 'stale route') window.history.replaceState({}, '', '/group/repo/-/merge_requests/2/diffs');
    if (mode === 'stale control') f.revoke();if (mode === 'closed fold') open = false;
    const target = mode === 'existing link' ? f.root.querySelector<HTMLAnchorElement>('.rd-line-number[data-position="old"] a')! : f.insert(mode === 'wrong line' ? 5 : 3);
    if (mode === 'wrong body') target.closest('tr')!.querySelector('.rd-line-text')!.textContent = 'different source\n';
    if (mode === 'old-only row') target.closest('tr')!.querySelector('[data-position="new"]')!.remove();
    if (mode === 'BODY only') f.control.blur();else target.focus();
  });
  f.manager.reveal(f.entry, f.fold, () => open, f.owner);await Promise.resolve();expect(document.activeElement).not.toBe(f.control);expect(focus).not.toHaveBeenCalled();
});
it('does not arm custody for a control that was not focused before the native activation', async () => { const f = await focusOperation(), focus = vi.spyOn(f.control, 'focus');f.control.blur();f.native.addEventListener('click', () => f.insert().focus());f.manager.reveal(f.entry, f.fold, () => true, f.owner);await Promise.resolve();expect(focus).not.toHaveBeenCalled(); });
it('uses one handoff at most for the entire trusted Show even across multiple progressing context activations', async () => {
  vi.useFakeTimers();const f = await focusOperation(), focus = vi.spyOn(f.control, 'focus');const insertions: HTMLAnchorElement[] = [];
  let steps = 0;
  f.step.mockImplementation(() => { steps++;return { current: () => true, activate: () => { const n = steps;const held = document.createElement('tbody');held.className = 'rd-text-view-content';held.innerHTML = f.row(n);f.native.closest('tbody')!.before(held);const target = held.querySelector<HTMLAnchorElement>('a')!;insertions.push(target);target.focus(); }, insertedFocus: (target) => { const row = target.closest('tr')!;return { row, newLine: steps, newText: source[steps - 1]! }; } }; });
  f.manager.reveal(f.entry, f.fold, () => true, f.owner);await vi.advanceTimersByTimeAsync(400);expect(focus).toHaveBeenCalledOnce();expect(insertions.length).toBeGreaterThan(1);expect(document.activeElement).toBe(insertions.at(-1));
});
it('removes operation listeners immediately on retirement or expiry before a later matching row focuses', async () => {
  vi.useFakeTimers();const f = await focusOperation(), focus = vi.spyOn(f.control, 'focus');f.manager.reveal(f.entry, f.fold, () => true, f.owner);await vi.advanceTimersByTimeAsync(8100);f.insert().focus();expect(focus).not.toHaveBeenCalled();
  const second = await focusOperation(), other = vi.spyOn(second.control, 'focus');second.manager.reveal(second.entry, second.fold, () => true, second.owner);second.manager.destroy();second.insert().focus();expect(other).not.toHaveBeenCalled();
});
it('releases the exact operation focus listener after success and immediately after unrelated focus cancellation', async () => {
  const first = await focusOperation(), add = vi.spyOn(document, 'addEventListener'), remove = vi.spyOn(document, 'removeEventListener');first.native.addEventListener('click', () => first.insert().focus());first.manager.reveal(first.entry, first.fold, () => true, first.owner);await vi.waitFor(() => expect(first.refresh).toHaveBeenCalledTimes(2));const installed = add.mock.calls.find(([name]) => name === 'focusin');expect(installed).toBeDefined();expect(remove.mock.calls.some(([name, listener]) => name === 'focusin' && listener === installed![1])).toBe(true);
  const second = await focusOperation(), outside = document.createElement('button');document.body.append(outside);add.mockClear();remove.mockClear();second.manager.reveal(second.entry, second.fold, () => true, second.owner);const next = add.mock.calls.find(([name]) => name === 'focusin');outside.focus();expect(remove.mock.calls.some(([name, listener]) => name === 'focusin' && listener === next![1])).toBe(true);second.insert().focus();expect(document.activeElement).not.toBe(second.control);
});
