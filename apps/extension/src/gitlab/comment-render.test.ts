// @vitest-environment happy-dom
import type { ProviderReviewComment } from '@geld/review';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { renderGitLabComment } from './comment-render';

const comment: ProviderReviewComment = {
  id: '11', anchor: 'note_11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11',
  author: { id: '23', login: 'author' }, body: '<img src="x" onerror="steal()">', createdAt: '2026-11-01T12:00:00Z',
};

function fixture(body: string): HTMLElement {
  window.location.href = comment.url;
  document.body.innerHTML = `<li id="note_11" data-testid="noteable-note-container"><div class="note-body"><div class="note-text md">${body}</div></div></li><div data-geld-ui id="digest-body">Safe raw fallback</div>`;
  const host = document.getElementById('digest-body');
  if (!(host instanceof HTMLElement)) throw new Error('Missing fixture host');
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-geld-provider');
  for (const token of ['--gl-background-color-default', '--gl-border-color-default']) document.documentElement.style.removeProperty(token);
});

describe('GitLab native Markdown cloning', () => {
  it('preserves actual rendered Markdown and code classes without moving or changing the source', () => {
    const host = fixture('<h3 id="source-heading">A heading</h3><p><strong>Words</strong> and <code class="code">call()</code></p><pre class="code highlight"><code><span class="k">return</span> 1</code></pre>');
    const source = document.getElementById('note_11');
    const before = source?.outerHTML;
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.querySelector('strong')?.textContent).toBe('Words');
    expect(host.querySelector('pre.code code .k')?.textContent).toBe('return');
    expect(host.querySelector('[id]')).toBeNull();
    expect(document.getElementById('note_11')).toBe(source);
    expect(source?.outerHTML).toBe(before);
    expect(host.querySelector('img')).toBeNull();
  });

  it('does not interpret raw source text or clone provider forms and live controls', () => {
    const host = fixture('<p>Rendered safe body</p><form action="/delete"><input name="token" value="secret"><button>Delete</button></form><textarea>Draft</textarea><div contenteditable="true">Private editor</div><script type="application/json">{"unsafe":true}</script>');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.textContent).toBe('Rendered safe body');
    expect(host.querySelector('form,input,button,textarea,[contenteditable],script,iframe')).toBeNull();
    expect(host.innerHTML).not.toContain('secret');
    expect(host.querySelector('img')).toBeNull();
  });

  it('keeps the observed Greptile table header labels without cloning GitLab sort controls', () => {
    // Reduced native note3381334808 in installed run41344637837, including GitLab's generated sort buttons.
    const header = (column: number, label: string): string => `<th aria-sort="none" scope="col" data-sourcepos="22:2-22:11" class="gl-group/markdown-table-header"><div class="gl-flex gl-items-center gl-gap-2"><button id="markdown-table-62-col_${column}-sort" type="button" class="gl-group gl-flex gl-cursor-pointer gl-items-center gl-gap-2 gl-border-0 gl-bg-transparent gl-p-0 gl-text-left gl-font-bold gl-text-inherit focus-visible:gl-outline-none"><span aria-hidden="true" class="gl-absolute gl-inset-0 group-focus-visible:gl-focus-inset"></span> <span>${label}</span> <svg data-testid="sort-lowest-icon" role="img" aria-hidden="true" class="gl-icon s16" data-sort-icon=""><use href="/assets/icons.svg#sort-lowest"></use></svg></button></div></th>`;
    const host = fixture(`<h3>Important Files Changed</h3><table class="gl-min-w-full gl-overflow-y-hidden"><thead><tr>${header(0, 'Filename')}${header(1, 'Overview')}</tr></thead><tbody><tr><td>backend/pyproject.toml</td><td>Updates dependencies</td></tr><tr><td>backend/poetry.lock</td><td>Locks packages</td></tr></tbody></table><button type="button">Re-trigger Greptile</button>`);
    const source = document.getElementById('note_11');
    const before = source?.outerHTML;
    const sourceTable = source?.querySelector('table');
    const sourceLabels = [...source?.querySelectorAll('th') ?? []].map((cell) => cell.textContent);
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect([...host.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(sourceLabels);
    expect(host.querySelector('table')?.textContent).toBe(sourceTable?.textContent);
    expect([...host.querySelectorAll('th')].map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'col']);
    expect([...host.querySelectorAll('[data-geld-native-table-header-label]')].map((label) => label.className)).toEqual(['gl-font-bold gl-text-inherit', 'gl-font-bold gl-text-inherit']);
    for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) expect(host.querySelectorAll(tag)).toHaveLength(source?.querySelectorAll(tag).length ?? 0);
    expect(host.querySelector('button,svg,use,[id],[aria-sort],[data-sort-icon],[data-sourcepos],[onclick]')).toBeNull();
    expect(host.textContent).not.toContain('Re-trigger Greptile');
    expect(document.getElementById('note_11')).toBe(source);
    expect(source?.outerHTML).toBe(before);
  });

  it('retains validated native header scope without cloning sort state or unknown scope values', () => {
    const host = fixture('<table><thead><tr><th scope="col" aria-sort="ascending">Column</th><th scope="row">Row</th><th scope="colgroup">Columns</th><th scope="rowgroup">Rows</th><th scope="unknown">Other</th></tr></thead></table>');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect([...host.querySelectorAll('th')].map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'row', 'colgroup', 'rowgroup', null]);
    expect(host.querySelector('[aria-sort]')).toBeNull();
  });

  it('retains verified native sticky-header paint through live tokens without copying sticky behavior', () => {
    document.documentElement.dataset.geldProvider = 'gitlab';
    document.documentElement.style.setProperty('--gl-background-color-default', 'rgb(248, 247, 246)');
    document.documentElement.style.setProperty('--gl-border-color-default', 'rgb(123, 124, 125)');
    const paint = readFileSync(new NodeURL('./comment-render.css', import.meta.url), 'utf8');
    // Exact current application stylesheet rule retained in run41334314934 and referenced by run41351669256.
    const native = '.md [data-sticky-header]>table:not(.code)>thead:first-of-type>tr:first-child>th{position:sticky;top:var(--gl-spacing-scale-0);background-color:var(--gl-background-color-default);z-index:var(--gl-zindex-1);border-top:0;border-bottom:0;box-shadow:inset 0 -1px 0 var(--gl-border-color-default)}';
    document.head.innerHTML = `<style>${native}${paint}</style>`;
    const host = fixture('<div data-sticky-header><table><thead><tr><th scope="col" aria-sort="none" class="gl-group/markdown-table-header"><div class="gl-flex"><button id="markdown-table-62-col_0-sort" type="button" class="gl-text-inherit gl-font-bold"><span>Filename</span><svg data-sort-icon="" aria-hidden="true"></svg></button></div></th></tr></thead></table></div>');
    host.classList.add('geld-provider-review__body');
    const source = document.querySelector('#note_11 th');
    if (!(source instanceof HTMLElement)) throw new Error('Missing native sticky header');
    const original = document.getElementById('note_11')?.outerHTML;
    expect(renderGitLabComment(comment, host)).toBe(true);
    const cell = host.querySelector('th[data-geld-native-sticky-header-cell]');
    if (!(cell instanceof HTMLElement)) throw new Error('Missing inert native-paint header');
    const properties: readonly ('backgroundColor' | 'boxShadow')[] = ['backgroundColor', 'boxShadow'];
    for (const property of properties) expect(getComputedStyle(cell)[property]).toBe(getComputedStyle(source)[property]);
    const before = getComputedStyle(cell).backgroundColor;
    expect(getComputedStyle(source).position).toBe('sticky');
    expect(getComputedStyle(cell).position).not.toBe('sticky');
    expect(host.querySelector('[data-sticky-header],[aria-sort],button,[style]')).toBeNull();
    document.documentElement.style.setProperty('--gl-background-color-default', 'rgb(31, 32, 33)');
    document.documentElement.style.setProperty('--gl-border-color-default', 'rgb(91, 92, 93)');
    expect(getComputedStyle(cell).backgroundColor).not.toBe(before);
    for (const property of properties) expect(getComputedStyle(cell)[property]).toBe(getComputedStyle(source)[property]);
    expect(document.getElementById('note_11')?.outerHTML).toBe(original);
    expect(cell.textContent).toBe('Filename');
  });

  it.each(['no sticky source', 'code table', 'unknown sort control'])('does not add native sticky paint for %s', (variant) => {
    const body = '<table><thead><tr><th scope="col" aria-sort="none" class="gl-group/markdown-table-header"><div class="gl-flex"><button id="markdown-table-62-col_0-sort" type="button" class="gl-text-inherit gl-font-bold"><span>Filename</span><svg data-sort-icon="" aria-hidden="true"></svg></button></div></th></tr></thead></table>';
    const host = fixture(variant === 'no sticky source' ? body : `<div data-sticky-header>${body}</div>`);
    if (variant === 'code table') document.querySelector('#note_11 table')?.classList.add('code');
    if (variant === 'unknown sort control') document.querySelector('#note_11 button')?.setAttribute('data-method', 'delete');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.querySelector('[data-geld-native-sticky-header-cell]')).toBeNull();
    expect(host.querySelector('[data-sticky-header],[aria-sort],button,[style]')).toBeNull();
  });

  it('preserves the observed sort button label weight when the table header itself has normal weight', () => {
    document.head.innerHTML = '<style>th { font-weight:400 } button { font:inherit } .gl-font-bold { font-weight:700 }</style>';
    const host = fixture('<table><thead><tr><th scope="col" aria-sort="none" class="gl-group/markdown-table-header"><div class="gl-flex"><button id="markdown-table-62-col_0-sort" type="button" class="gl-text-inherit gl-font-bold"><span>Filename</span><svg data-sort-icon="" aria-hidden="true"></svg></button></div></th></tr></thead></table>');
    const source = document.querySelector('#note_11 th');
    const native = source?.querySelector('button > span');
    if (!(source instanceof HTMLElement) || !(native instanceof HTMLElement)) throw new Error('Missing native label');
    expect(getComputedStyle(source).fontWeight).toBe('400');
    expect(getComputedStyle(native).fontWeight).toBe('700');
    expect(renderGitLabComment(comment, host)).toBe(true);
    const label = host.querySelector('[data-geld-native-table-header-label]');
    if (!(label instanceof HTMLElement)) throw new Error('Missing inert label');
    expect(getComputedStyle(label).fontWeight).toBe(getComputedStyle(native).fontWeight);
    expect(label.tagName).toBe('SPAN');
    expect(host.querySelector('button')).toBeNull();
  });

  it('drops unknown table buttons instead of treating arbitrary controls as header content', () => {
    const button = '<button id="markdown-table-62-col_0-sort" type="button"><span>Unknown action</span></button>';
    const host = fixture(`<table><thead><tr><th>${button}</th></tr></thead><tbody><tr><td>${button}</td></tr></tbody></table><p>${button}</p>`);
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.textContent).not.toContain('Unknown action');
    expect(host.querySelector('button,[id]')).toBeNull();
  });

  it.each(['wrong column', 'action attribute', 'nested label', 'outside header'])('rejects a generated-looking button with %s', (change) => {
    const host = fixture('<table><thead><tr><th scope="col" aria-sort="none" class="gl-group/markdown-table-header"><div class="gl-flex"><button id="markdown-table-62-col_0-sort" type="button" class="gl-text-inherit gl-font-bold"><span>Unknown action</span><svg data-sort-icon="" aria-hidden="true"></svg></button></div></th></tr></thead></table>');
    const source = document.getElementById('note_11');
    const button = source?.querySelector('button');
    if (button === null || button === undefined) throw new Error('Missing candidate control');
    if (change === 'wrong column') button.id = 'markdown-table-62-col_1-sort';
    if (change === 'action attribute') button.setAttribute('data-method', 'delete');
    if (change === 'nested label') button.querySelector('span')?.append(document.createElement('a'));
    if (change === 'outside header') source?.querySelector('.note-text')?.append(button);
    const before = source?.outerHTML;
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.textContent).not.toContain('Unknown action');
    expect(host.querySelector('button,[id],[data-method],svg')).toBeNull();
    expect(source?.outerHTML).toBe(before);
  });

  // Reduced native control/wrapper shape from CodeRabbit note3436654383 in run41369261628; no bot body copied.
  const heightWrapperClass = 'gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden';
  const heightControl = `<div class="${heightWrapperClass}"><button aria-expanded="false" aria-controls="markdown-table-176-scroll" data-testid="markdown-table-height-toggle" type="button" class="btn gl-button btn-default btn-sm btn-default-tertiary"><!----> <svg data-testid="expand-icon" role="img" aria-hidden="true" class="gl-button-icon gl-icon s16 gl-fill-current"><use href="/assets/icons-9e15b4326314733309933b50748c4a8bd745613ff01a7aa1136499f9228ffcf6.svg#expand"></use></svg>  <span class="gl-button-text">
      Show full table
     <!----></span></button></div>`;
  const tableBody = (hydrated: boolean): string => `<p>Authored introduction</p><div class="gl-my-5 gl-flex gl-w-fit gl-max-w-full gl-flex-col"><div data-testid="table-shadow-overlay" class="gl-table-shadow-overlay"><div id="markdown-table-176-scroll" data-sticky-header="" data-print-scale-container="" class="gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none"><table data-markdown-table-applied="true" class="gl-min-w-full gl-overflow-y-hidden"><thead><tr><th scope="col">File</th><th scope="col">Summary</th></tr></thead><tbody><tr><td>first.rs</td><td>First row</td></tr><tr><td>last.rs</td><td>Last row</td></tr></tbody></table></div></div>${hydrated ? heightControl : '<!---->'}<div role="status" aria-live="polite" aria-atomic="true" class="gl-sr-only"><span></span></div></div><p>Authored conclusion</p>`;

  it('keeps exact owned HTML across native table-height hydration without changing the source, height classes or rows', () => {
    const initialHost = fixture(tableBody(false));
    expect(renderGitLabComment(comment, initialHost)).toBe(true);
    const beforeHydration = initialHost.innerHTML;
    const host = fixture(tableBody(true));
    const source = document.getElementById('note_11');
    const original = source?.outerHTML;
    const nativeControl = source?.querySelector('button');
    const nativeScroll = source?.querySelector('#markdown-table-176-scroll');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.innerHTML).toBe(beforeHydration);
    expect([...host.querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual(['first.rs', 'First row', 'last.rs', 'Last row']);
    expect(host.querySelector('[class~="gl-overflow-y-auto"]')?.className).toBe(nativeScroll?.className);
    expect(host.querySelector('[class~="gl-overflow-y-auto"]')?.classList.contains('gl-max-h-[70vh]')).toBe(true);
    expect(host.querySelector('[class~="gl-order-1"],button,svg,[id],[aria-controls],[data-testid],[data-sticky-header]')).toBeNull();
    expect(source?.outerHTML).toBe(original);
    expect(source?.querySelector('button')).toBe(nativeControl);
    expect(source?.querySelector('#markdown-table-176-scroll')).toBe(nativeScroll);
  });

  it('does not depend on the incidental icon asset hash or decoration classes', () => {
    const host = fixture(tableBody(true));
    const source = document.querySelector('#note_11 .note-text');
    const icon = source?.querySelector('svg');
    const use = icon?.querySelector('use');
    if (icon === null || icon === undefined || use === null || use === undefined) throw new Error('Missing inert native icon');
    icon.setAttribute('class', 'updated-native-icon');icon.removeAttribute('data-testid');icon.setAttribute('viewBox', '0 0 16 16');
    use.setAttribute('href', '/assets/new-native-icon-bundle.svg#expand');
    const original = source?.outerHTML;
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.querySelector('[class~="gl-order-1"]')).toBeNull();
    expect(host.querySelector('button,svg,[id],[aria-controls]')).toBeNull();
    expect(source?.outerHTML).toBe(original);
  });

  const heightVariants: readonly { readonly label: string; readonly edit: (source: HTMLElement, wrapper: HTMLElement) => void }[] = [
    { label: 'authored text', edit: (_source, wrapper) => wrapper.prepend(document.createTextNode('Preserve authored text')) },
    { label: 'another element child', edit: (_source, wrapper) => { const note = document.createElement('p');note.textContent = 'Preserve authored paragraph';wrapper.append(note); } },
    { label: 'empty wrapper with no button', edit: (_source, wrapper) => wrapper.replaceChildren() },
    { label: 'missing binding', edit: (_source, wrapper) => wrapper.querySelector('button')?.removeAttribute('aria-controls') },
    { label: 'malformed binding', edit: (_source, wrapper) => wrapper.querySelector('button')?.setAttribute('aria-controls', 'markdown-table-0176-scroll') },
    { label: 'duplicate target ID', edit: (source) => { const target = source.querySelector('#markdown-table-176-scroll');if (target !== null) source.append(target.cloneNode(true)); } },
    { label: 'duplicate control binding', edit: (_source, wrapper) => wrapper.parentElement?.append(wrapper.cloneNode(true)) },
    { label: 'target outside this source', edit: (source) => { const target = source.querySelector('#markdown-table-176-scroll');if (target !== null) document.body.append(target); } },
    { label: 'target outside the sibling shadow wrapper', edit: (source) => { const shadow = source.querySelector('[data-testid="table-shadow-overlay"]');if (shadow !== null) source.append(shadow); } },
    { label: 'missing native scroll marker', edit: (source) => source.querySelector('#markdown-table-176-scroll')?.removeAttribute('data-sticky-header') },
    { label: 'extra authored scroll child', edit: (source) => { const child = document.createElement('p');child.textContent = 'Additional authored content';source.querySelector('#markdown-table-176-scroll')?.append(child); } },
    { label: 'provider action attribute', edit: (_source, wrapper) => wrapper.querySelector('button')?.setAttribute('data-method', 'delete') },
    { label: 'unobserved button label', edit: (_source, wrapper) => { const label = wrapper.querySelector('.gl-button-text');if (label !== null) label.textContent = 'Another action'; } },
    { label: 'unobserved expanded state', edit: (_source, wrapper) => wrapper.querySelector('button')?.setAttribute('aria-expanded', 'true') },
    { label: 'authored wrapper attribute', edit: (_source, wrapper) => wrapper.setAttribute('title', 'Authored title') },
    { label: 'nondecorative icon', edit: (_source, wrapper) => wrapper.querySelector('svg')?.setAttribute('aria-hidden', 'false') },
    { label: 'interactive icon', edit: (_source, wrapper) => wrapper.querySelector('svg')?.setAttribute('tabindex', '0') },
  ];
  it.each(heightVariants)('preserves the table presentation wrapper with $label', ({ edit, label }) => {
    const host = fixture(tableBody(true));
    const source = document.querySelector<HTMLElement>('#note_11 .note-text');
    const wrapper = source?.querySelector<HTMLElement>('[class~="gl-order-1"]');
    if (source === null || source === undefined || wrapper === null || wrapper === undefined) throw new Error('Missing reduced native table fixture');
    edit(source, wrapper);
    const original = source.outerHTML;
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.querySelector('[class~="gl-order-1"]')).not.toBeNull();
    if (label === 'authored text') expect(host.textContent).toContain('Preserve authored text');
    if (label === 'another element child') expect(host.textContent).toContain('Preserve authored paragraph');
    if (label === 'extra authored scroll child') expect(host.textContent).toContain('Additional authored content');
    expect(host.querySelector('button,svg,[id],[aria-controls],[data-method],[onclick]')).toBeNull();
    expect(source.outerHTML).toBe(original);
  });

  it('retains generic authored empty DIVs rather than pruning presentation-looking empties', () => {
    const host = fixture('<div></div><div class="gl-my-5"></div><p>Authored text</p>');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.querySelector('.note-text')?.innerHTML).toBe('<div></div><div class="gl-my-5"></div><p>Authored text</p>');
  });

  it('removes event and provider-action attributes and validates link protocols', () => {
    const host = fixture('<p id="paragraph" onclick="steal()" style="color:red"><a class="gfm js-user-link" href="/group/repo/-/issues/2" data-method="delete" data-user-id="23" target="_top">Issue</a><a href="javascript:steal()">Bad</a><a href="https://outside.example/docs" onmouseover="steal()">Docs</a><a href="#source-heading">Heading</a></p>');
    expect(renderGitLabComment(comment, host)).toBe(true);
    const links = host.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe('https://gitlab.com/group/repo/-/issues/2');
    expect(links[0]?.className).toBe('gfm');
    expect(links[0]?.hasAttribute('data-method')).toBe(false);
    expect(links[0]?.hasAttribute('target')).toBe(false);
    expect(links[1]?.hasAttribute('href')).toBe(false);
    expect(links[2]?.getAttribute('target')).toBe('_blank');
    expect(links[2]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[3]?.getAttribute('href')).toBe('https://gitlab.com/group/repo/-/merge_requests/7#source-heading');
    expect(host.querySelector('[onclick],[onmouseover],[style],[data-user-id]')).toBeNull();
  });

  it('keeps native task status as text and unwraps custom emoji without cloning active custom elements', () => {
    const host = fixture('<ul><li><input type="checkbox" disabled checked>Done</li><li><input type="checkbox" disabled>Next</li></ul><gl-emoji data-name="wave">👋</gl-emoji><custom-widget><em>Kept markup</em><textarea>Hidden draft</textarea></custom-widget>');
    expect(renderGitLabComment(comment, host)).toBe(true);
    expect(host.textContent).toContain('☑ Done');
    expect(host.textContent).toContain('☐ Next');
    expect(host.textContent).toContain('👋');
    expect(host.querySelector('em')?.textContent).toBe('Kept markup');
    expect(host.textContent).not.toContain('Hidden draft');
    expect(host.querySelector('input,gl-emoji,custom-widget,textarea')).toBeNull();
  });

  it('returns false with untouched fallback when native body is absent or already inside Geld', () => {
    const host = fixture('<p>Source</p>');
    expect(renderGitLabComment({ ...comment, id: '12', anchor: 'note_12' }, host)).toBe(false);
    expect(host.textContent).toBe('Safe raw fallback');
    document.getElementById('note_11')?.setAttribute('data-geld-ui', '');
    expect(renderGitLabComment(comment, host)).toBe(false);
    expect(host.textContent).toBe('Safe raw fallback');
  });

  it('refuses to render a source under another provider origin', () => {
    const host = fixture('<p>Source</p>');
    expect(renderGitLabComment({ ...comment, url: 'https://attacker.example/#note_11' }, host)).toBe(false);
    expect(host.textContent).toBe('Safe raw fallback');
  });
});
