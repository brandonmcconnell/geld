// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readGitLabDiff } from './diff';
import { createGitLabWorkflowSyntax } from './workflow-syntax';
import { readGitLabShellPalette } from './shell-palette';
import { GitLabNativeWhitespace } from './native-whitespace';
import { describeGitLabPage, record } from './page';
import { providerDiffSourceFacts, providerOutlineContext } from '../providers/source-facts';

// Public Step Runner MR253's included CI file; syntax evidence, not a pipeline execution claim.
const PUBLIC_CONFIG = "\nscript step/bash:\n  extends: .e2e:use-pipeline-runner\n  image: alpine:${ALPINE_VERSION}\n  run:\n    - name: install_bash\n      script: apk add bash && which bash\n    - name: verify_bash_installed\n      script: if ! command -v bash 2>&1 >/dev/null; then echo \"bash not found, aborting test\" && exit 1; fi\n    - name: echo_shell\n      script: echo \"Using shell $0\" && echo \"{\\\"name\\\":\\\"USED_SHELL\\\",\\\"value\\\":\\\"Using shell $0\\\"}\" >${{ export_file }}\n    - name: verify_shell_used\n      script: '[[ \"$USED_SHELL\" =~ ^Using\\ shell\\ .*/bash$ ]] || (printf \"Expected: Using shell (.*)bash\\n  Actual: $USED_SHELL\\n\" && exit 1)'\n\nscript step/sh:\n  extends: .e2e:use-pipeline-runner\n  image: alpine:${ALPINE_VERSION}\n  run:\n    - name: verify_bash_not_installed\n      script: if command -v bash 2>&1 >/dev/null; then echo \"bash is found and should not be, aborting test\" && exit 1; fi\n    - name: echo_shell\n      script: echo \"Using shell $0\" && echo \"{\\\"name\\\":\\\"USED_SHELL\\\",\\\"value\\\":\\\"Using shell $0\\\"}\" >${{ export_file }}\n    - name: verify_shell_used\n      script: '[[ \"$USED_SHELL\" =~ ^Using\\ shell\\ .*/sh$ ]] || (printf \"Expected: Using shell (.*)sh\\n  Actual: $USED_SHELL\\n\" && exit 1)'\n";
const H = 'a'.repeat(40), B = 'b'.repeat(40);
const registry = new Map<string, Set<StaticRange>>();
const running: ReturnType<typeof createGitLabWorkflowSyntax>[] = [];
let nextReview = 42;

function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing fixture');return value; }
function colors(dark = false): string {
  return `.code-syntax-highlight-theme{color:rgb(17,34,51);--code-text-color:rgb(51,51,51)}
.code-syntax-highlight-theme .k,.code-syntax-highlight-theme .kc{${dark ? 'color:rgb(178,148,187);' : ''}font-weight:600}
.code-syntax-highlight-theme .nb{color:${dark ? 'rgb(197,200,198)' : 'rgb(0,134,179)'}}
.code-syntax-highlight-theme .nv{color:rgb(0,128,128)}
.code-syntax-highlight-theme .c{color:rgb(153,153,136);font-style:italic}
.code-syntax-highlight-theme .s2{color:${dark ? 'rgb(181,189,104)' : 'rgb(221,17,68)'}}
.code-syntax-highlight-theme .m{color:rgb(0,153,153)}
.code-syntax-highlight-theme .nf{color:rgb(153,0,0)}
.code-syntax-highlight-theme .nt{color:rgb(0,0,128)}`;
}
function theme(dark = false) {
  const style = document.createElement('style');style.textContent = colors(dark);document.head.append(style);
  const link = document.createElement('link');link.rel = 'stylesheet test-fixture';link.href = '/assets/highlight/themes/test-' + H + '.css';document.head.append(link);
  const sheet = required(style.sheet);Object.defineProperty(sheet, 'href', { configurable: true, value: link.href });Object.defineProperty(sheet, 'ownerNode', { configurable: true, value: link });Object.defineProperty(link, 'sheet', { configurable: true, value: sheet });
  return { style, link, sheet };
}
function fixture(config = PUBLIC_CONFIG, path = 'dist/steps/script/.gitlab-ci.yml', options: { first?: number; gap?: number; split?: string; lf?: boolean } = {}) {
  const review = nextReview++;const base = `https://gitlab.com/acme/project/-/merge_requests/${review}`;window.location.href = base + '/diffs?diff_id=123';
  const app = { iid: review, project_path: 'acme/project', mr_path: new URL(base).pathname, is_fork: false, file_by_file_mode: false, versions: { source_versions: [{ id:123,selected:true,head_sha:H,is_merge_head:false }], target_versions: [{ id:123,selected:true,head_sha:H,start_sha:B,is_merge_head:false }] } };
  document.body.innerHTML = `<article data-rapid-diffs><div data-diffs-list><diff-file id="${'c'.repeat(40)}"><article><table class="rd-text-view-root code-syntax-highlight-theme"><tbody></tbody></table></article><diff-file-mounted></diff-file-mounted></diff-file></div></article>`;
  required(document.querySelector('[data-rapid-diffs]')).setAttribute('data-app-data', JSON.stringify(app));
  const file = required(document.querySelector<HTMLElement>('diff-file'));
  file.setAttribute('data-file-data', JSON.stringify({ old_path:path,new_path:path,diff_refs:{base_sha:B,start_sha:B,head_sha:H},blob_raw_path:`/acme/project/-/raw/${H}/${path}`,diff_lines_path:`/acme/project/-/blob/${H}/${path}/diff_lines` }));
  const body = required(file.querySelector('tbody'));const lines = config.replace(/\n$/, '').split('\n');const old = options.split?.replace(/\n$/, '').split('\n');
  lines.forEach((text, index) => {
    const number = (options.first ?? 1) + index + (options.gap !== undefined && index >= options.gap ? 1 : 0);
    const row = document.createElement('tr');row.className = old === undefined ? 'rd-hunk-lines-inline' : 'rd-hunk-lines-parallel';
    const add = (side: 'old' | 'new', content: string) => {
      const cell = document.createElement('td');cell.className = 'rd-line-number';cell.dataset.position = side;cell.innerHTML = `<a data-line-number="${number}">${number}</a>`;row.append(cell);
      const code = document.createElement('td');code.className = 'rd-line-content';if (old !== undefined) code.dataset.position = side;
      const node = document.createElement('span');node.className = 'rd-line-text';node.style.color = 'rgb(51,51,51)';node.textContent = content + (options.lf ? '\n' : '');code.append(node);row.append(code);
    };
    if (old !== undefined) add('old', old[index] ?? '');add('new', text);body.append(row);
  });
  return { file, table: required(file.querySelector<HTMLTableElement>('table')), text: required(file.querySelector<HTMLElement>('.rd-line-text')) };
}
function run() { const syntax = createGitLabWorkflowSyntax();running.push(syntax);syntax.apply(required(readGitLabDiff(document)));return syntax; }
function texts(scope: string): string[] {
  return [...registry].filter(([name]) => name.endsWith('-' + scope)).flatMap(([, values]) => [...values].map((range) => {
    expect(range.startContainer).toBe(range.endContainer);return (range.startContainer.textContent ?? '').slice(range.startOffset,range.endOffset);
  }));
}
beforeEach(() => {
  registry.clear();vi.stubGlobal('CSS', { highlights: registry, supports: (property: string, value: string) => property === 'color' && /^(?:rgb|#)/.test(value) });
  vi.stubGlobal('Highlight', class extends Set<StaticRange> {});vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { for (const syntax of running.splice(0)) syntax.clear();document.body.replaceChildren();document.head.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals(); });

it('colors the real nested local native run while keeping extends unresolved and source nodes unchanged', () => {
  const f = fixture();theme();const before = f.file.outerHTML;const nodes = [...f.file.querySelectorAll('.rd-line-text')].map((node) => node.firstChild);
  run();expect(texts('keyword')).toContain('if');expect(texts('built_in')).toContain('echo');expect(texts('string')).toContain('"bash not found, aborting test"');expect(texts('plain').join('')).not.toContain('extends');
  expect(f.file.outerHTML).toBe(before);expect([...f.file.querySelectorAll('.rd-line-text')].map((node) => node.firstChild)).toEqual(nodes);expect(f.file.querySelector('[data-geld-ui]')).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it('uses the loaded native code theme and removes temporary owned probes', () => {
  const f = fixture();theme();const before = f.file.outerHTML;const palette = readGitLabShellPalette(f.table, f.text);
  expect(palette?.keyword).toBe('rgb(51, 51, 51)');expect(palette?.built_in).toBe('rgb(0, 134, 179)');expect(palette?.string).toBe('rgb(221, 17, 68)');expect(f.file.outerHTML).toBe(before);
});
it('changes colors with the actual loaded theme without changing code typography', () => {
  const f = fixture();const t = theme();const font = getComputedStyle(f.text).font;const syntax = run();const light = document.head.querySelector('style[data-geld-ui]')?.textContent;
  t.style.textContent = colors(true);syntax.apply(required(readGitLabDiff(document)));const dark = document.head.querySelector('style[data-geld-ui]')?.textContent;
  expect(dark).not.toBe(light);expect(dark).toContain('rgb(178, 148, 187)');expect(getComputedStyle(f.text).font).toBe(font);
});
it('refreshes native colors on media changes and releases all media listeners on clear',()=>{
  fixture();const t=theme();const original=window.matchMedia.bind(window),queries=new Map<string,MediaQueryList>();
  vi.spyOn(window,'matchMedia').mockImplementation((name)=>{let value=queries.get(name);if(value===undefined){value=original(name);queries.set(name,value);}return value;});
  const syntax=run();const before=document.head.querySelector('style[data-geld-ui]')?.textContent;t.style.textContent=colors(true);required(queries.get('(prefers-color-scheme: dark)')).dispatchEvent(new Event('change'));
  expect(document.head.querySelector('style[data-geld-ui]')?.textContent).not.toBe(before);expect(document.head.querySelector('style[data-geld-ui]')?.textContent).toContain('rgb(178, 148, 187)');
  syntax.clear();required(queries.get('(prefers-color-scheme: dark)')).dispatchEvent(new Event('change'));expect(registry.size).toBe(0);expect(document.head.querySelector('style[data-geld-ui]')).toBeNull();
});
it('waits for a disabled native theme to load without issuing stylesheet requests',()=>{
  fixture();const t=theme();t.link.disabled=true;run();expect(registry.size).toBe(0);t.link.disabled=false;t.link.dispatchEvent(new Event('load'));expect(registry.size).toBeGreaterThan(0);expect(fetch).not.toHaveBeenCalled();
});
it('uses code foreground rather than an enclosing YAML string color',()=>{
  const f=fixture();theme();f.text.style.color='rgb(221,17,68)';const palette=readGitLabShellPalette(f.table,f.text);expect(palette?.plain).toBe('rgb(51, 51, 51)');expect(palette?.keyword).toBe('rgb(51, 51, 51)');
});
it.each(['missing','disabled','foreign','unavailable','unmatched'])('keeps native rendering when palette is %s', (mode) => {
  fixture();const t = theme();if (mode === 'missing') t.link.remove();if (mode === 'disabled') t.link.disabled = true;if (mode === 'foreign') t.link.href = 'https://other.invalid/assets/highlight/themes/test-' + H + '.css';
  if (mode === 'unavailable') Object.defineProperty(t.sheet,'cssRules',{get(){throw new Error('unavailable');}});if (mode === 'unmatched') t.style.textContent = '.other .k{color:red}';
  run();expect(registry.size).toBe(0);expect(document.querySelector('diff-file [data-geld-ui]')).toBeNull();
});
it('removes the palette probe even when a native style getter fails mid-read', () => {
  const f=fixture();theme();const original=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation((node,...rest)=>{ if(node.className==='nb') throw Error('failed');return original(node,...rest); });
  expect(readGitLabShellPalette(f.table,f.text)).toBeNull();expect(f.file.querySelector('[data-geld-ui]')).toBeNull();
});
it('excludes only the renderer LF from ranges',()=>{fixture(PUBLIC_CONFIG,undefined,{lf:true});theme();run();expect(texts('keyword')).toContain('if');for(const values of registry.values())for(const range of values)expect((range.startContainer.textContent??'').slice(range.startOffset,range.endOffset)).not.toContain('\n');});
it('keeps split-view programs on their own side',()=>{fixture(PUBLIC_CONFIG,undefined,{split:PUBLIC_CONFIG.replace('bash not found','old shell missing')});theme();run();expect(texts('string')).toContain('"old shell missing, aborting test"');expect(texts('string')).toContain('"bash not found, aborting test"');});
it.each([
 ['arbitrary filename',PUBLIC_CONFIG,'other.yml',{}],
 ['missing prefix',PUBLIC_CONFIG,'.gitlab-ci.yml',{first:2}],
 ['gap before job end',PUBLIC_CONFIG,'.gitlab-ci.yml',{gap:7}],
 ['unfinished only job','job:\n  run:\n    - name: one\n      script: echo hello\n','.gitlab-ci.yml',{}],
 ['classic heredoc','job:\n  script: |\n    run:\n      - name: one\n        script: echo wrong\nnext:\n  script: ignored\n','.gitlab-ci.yml',{}],
 ['reserved variables','variables:\n  run:\n    - name: one\n      script: echo wrong\nnext:\n  script: ignored\n','.gitlab-ci.yml',{}],
 ['duplicate key','job:\n  run: []\n  run: []\nnext:\n  script: ignored\n','.gitlab-ci.yml',{}],
 ['classic conflict','job:\n  script: ignored\n  run:\n    - name: one\n      script: echo wrong\nnext:\n  script: ignored\n','.gitlab-ci.yml',{}],
])('leaves %s native',(_name,config,path,options)=>{fixture(config,path,options);theme();run();expect(registry.size).toBe(0);});
it.each([
 '      script: echo ${{ value }}',
 '      script: echo $[[ inputs.value ]]',
 '      script: "echo quoted"',
 '      script: >\n        echo folded',
 '      script: echo unknown\n      step: elsewhere',
 '      script: echo unknown\n      func: elsewhere',
])('skips an ambiguous or unmappable scalar %s',(script)=>{fixture('job:\n  run:\n    - name: one\n'+script+'\nnext:\n  script: ignored\n');theme();run();expect(registry.size).toBe(0);});
it('maps a literal script body without painting YAML indentation or headers',()=>{fixture('job:\n  extends: missing\n  run:\n    - name: one\n      script: |\n        if true; then\n          echo "yes"\n        fi\nnext:\n  script: ignored\n');theme();run();expect(texts('keyword')).toContain('if');expect(texts('built_in')).toContain('echo');expect(texts('plain').join('')).not.toContain('script:');});
it('retires ranges when native source metadata changes and removes only owned highlights',()=>{const f=fixture();theme();const foreign=new Set<StaticRange>();registry.set('foreign',foreign);const syntax=run();expect(registry.size).toBeGreaterThan(1);f.file.setAttribute('data-file-data',required(f.file.getAttribute('data-file-data')).replace('/raw/','/unqualified/'));syntax.apply(required(readGitLabDiff(document)));expect([...registry.keys()]).toEqual(['foreign']);syntax.clear();expect(registry.get('foreign')).toBe(foreign);});
it('keeps native reload frames and line readers valid while probing current theme colors',()=>{
  const f=fixture();theme();const root=required(document.querySelector<HTMLElement>('[data-rapid-diffs]'));
  root.insertAdjacentHTML('afterbegin','<header class="rd-app-header" aria-label="View controls"><div class="gl-new-dropdown" aria-label="Preferences"><button type="button" class="js-show-diff-settings" data-testid="base-dropdown-toggle" role="combobox" aria-expanded="false">Preferences</button><div data-testid="base-dropdown-menu"><input id="show" type="checkbox" value="true" data-testid="show-whitespace"><label for="show">Show whitespace changes</label><input id="single" type="checkbox" value="true" data-testid="file-by-file"><label for="single">Show one file at a time</label></div></div></header><div data-diffs-overlay></div><div data-list-loading hidden="hidden"></div><div data-diffs-list-alert></div>');
  document.body.insertAdjacentHTML('afterbegin','<a data-testid="topbar-signin-button" href="/users/sign_in">Sign in</a><div id="js-vue-mr-discussions" data-current-user-data="null"></div>');
  document.body.dataset.projectId='123';document.body.dataset.projectFullPath='acme/project';
  const app:unknown=JSON.parse(required(root.getAttribute('data-app-data')));if(!record(app))throw Error('Invalid fixture');root.setAttribute('data-app-data',JSON.stringify({...app,reload_stream_url:window.location.pathname.replace(/\/diffs$/, '/diffs_stream')+'?diff_id=123',diff_view_type:'inline'}));
  const page=required(describeGitLabPage(new URL(document.URL),document));const facts=required(providerDiffSourceFacts(page,{kind:'gitlab-review',headSha:H,baseSha:B,diffId:'123',commitId:null,projectPath:'acme/project',target:{id:'123',headSha:H,startSha:B,mergeHead:false}},[{path:'dist/steps/script/.gitlab-ci.yml',newPath:'dist/steps/script/.gitlab-ci.yml'}]));
  const result={complete:true,revision:'source',sourceFacts:facts,files:[{path:'dist/steps/script/.gitlab-ci.yml',additions:1,deletions:0}]};
  const session=new GitLabNativeWhitespace(document,()=>undefined,()=>undefined,()=>true);
  try {
    session.update(page,result);const field=required(document.querySelector<HTMLInputElement>('#show'));field.checked=true;field.dispatchEvent(new Event('click',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    const list=required(root.querySelector('[data-diffs-list]')),overlay=required(root.querySelector('[data-diffs-overlay]')),loading=required(root.querySelector('[data-list-loading]'));
    overlay.setAttribute('data-loading','true');const clone=f.file.cloneNode(true);list.replaceChildren();overlay.removeAttribute('data-loading');loading.removeAttribute('hidden');list.append(clone);loading.setAttribute('hidden','hidden');
    const view=required(readGitLabDiff(document)),frame=required(view.readNewSourceFrame?.()),entry=required(view.entries[0]);expect(frame.current()).toBe(true);
    const lines=entry.readLines?.();const context=providerOutlineContext(page,result,view);expect(context.newSources.size).toBe(1);
    run();expect(texts('keyword')).toContain('if');expect(frame.current()).toBe(true);expect(session.sourceUnavailable()).toBe(false);expect(entry.readLines?.()).toEqual(lines);expect(providerOutlineContext(page,result,view).newSources.size).toBe(1);expect(root.querySelector('[data-geld-ui]')).toBeNull();
  } finally { session.stop(); }
});
it('colors an explicit anchored declaration but does not resolve an alias as a new local program',()=>{
  fixture('job:\n  run: &steps\n    - name: one\n      script: &command echo local\nnext:\n  run: *steps\nlast:\n  script: ignored\n');theme();run();expect(texts('built_in').filter((text)=>text==='echo')).toHaveLength(1);
});

it('moves ranges to remounted original native Text nodes',()=>{
  const f=fixture();theme();const syntax=run();const old=new Set([...registry.values()].flatMap((values)=>[...values].map((range)=>range.startContainer)));
  const replacement=f.file.cloneNode(true);f.file.replaceWith(replacement);syntax.apply(required(readGitLabDiff(document)));
  expect(texts('keyword')).toContain('if');for(const ranges of registry.values())for(const range of ranges){expect(old.has(range.startContainer)).toBe(false);expect(range.startContainer.isConnected).toBe(true);}
});
it('clears owned ranges when the current source frame refuses a read',()=>{
  fixture();theme();const syntax=run();const view=required(readGitLabDiff(document)),frame=required(view.readNewSourceFrame?.());
  syntax.apply({...view,readNewSourceFrame:()=>({...frame,current:()=>false})});expect(registry.size).toBe(0);expect(document.head.querySelector('style[data-geld-ui]')).toBeNull();
});
it.each([
  '    - name: two\n      script: echo invalid\n      unknown: value',
  '    - name: two\n      script: echo invalid\n      step: external',
  '    - name: two\n      func: external',
  '    - name: two\n      script: [echo, invalid]',
  '    - name: two\n      script: echo invalid\n      env: *unresolved',
  '    - name: two\n      script: echo invalid\n      inputs: {}',
])('refuses a malformed sibling native run entry %s',(invalid)=>{
  fixture('job:\n  run:\n    - name: one\n      script: echo local\n'+invalid+'\nnext:\n  script: ignored\n');theme();run();expect(registry.size).toBe(0);
});
it('ignores a valid external step beside an explicit local script without resolving it',()=>{
  fixture('job:\n  run:\n    - name: external\n      step: gitlab.com/project/step@main\n      inputs:\n        value: hello\n    - name: local\n      script: echo local\n      env:\n        NAME: local\nnext:\n  script: ignored\n');theme();run();expect(texts('built_in')).toContain('echo');expect(fetch).not.toHaveBeenCalled();
});

it('rejects a native sheet whose effective media differs from its active link media',()=>{
  fixture();const t=theme();t.link.media='all';Object.defineProperty(t.sheet,'media',{configurable:true,value:'print'});
  const original=window.matchMedia.bind(window);vi.spyOn(window,'matchMedia').mockImplementation((name)=>{const value=original(name);if(name==='print')Object.defineProperty(value,'matches',{configurable:true,value:false});return value;});
  run();expect(registry.size).toBe(0);expect(document.querySelector('diff-file [data-geld-ui]')).toBeNull();
});
it('watches effective stylesheet media and releases its listener on clear',()=>{
  fixture();const t=theme();t.link.media='all';Object.defineProperty(t.sheet,'media',{configurable:true,value:'(min-width: 1px)'});
  const original=window.matchMedia.bind(window),queries=new Map<string,MediaQueryList>();
  vi.spyOn(window,'matchMedia').mockImplementation((name)=>{let value=queries.get(name);if(value===undefined){value=original(name);Object.defineProperty(value,'matches',{configurable:true,value:true});queries.set(name,value);}return value;});
  const syntax=run();expect(registry.size).toBeGreaterThan(0);const effective=required(queries.get('(min-width: 1px)'));const remove=vi.spyOn(effective,'removeEventListener');
  Object.defineProperty(effective,'matches',{configurable:true,value:false});effective.dispatchEvent(new Event('change'));expect(registry.size).toBe(0);
  Object.defineProperty(effective,'matches',{configurable:true,value:true});effective.dispatchEvent(new Event('change'));expect(registry.size).toBeGreaterThan(0);
  syntax.clear();expect(remove).toHaveBeenCalledWith('change',expect.any(Function));effective.dispatchEvent(new Event('change'));expect(registry.size).toBe(0);
});
