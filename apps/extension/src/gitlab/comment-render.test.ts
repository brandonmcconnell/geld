// @vitest-environment happy-dom
import type { ProviderReviewComment } from '@geld/review';
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

afterEach(() => { document.body.innerHTML = ''; });

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
