// @vitest-environment happy-dom
import { buildProviderReviewItems, createNativePublication } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from '@geld/review';
import { parseGitLabDiscussions, fetchGitLabReview } from './review';
import type { GitLabRenderedNote } from './review';
import { renderGitLabComment } from './comment-render';
import type { ProviderReviewPage } from '../providers/types';

const HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
const URL = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: '272', headSha: HEAD };
const scope = { projectId: '56243493', noteableId: '488567980' };
// Minimal native records from retained complete whitebox!272 discussions; no provider access in these tests.
const records = [
  {
    "id": "6014438f64fc0ad72ee4214b25ef3a6a233d000d",
    "resolvable": true,
    "resolved": true,
    "diff_discussion": true,
    "active": false,
    "position": {
      "base_sha": "57f5a9362ac34af81ef6ff568e2721ee72caaa4b",
      "start_sha": "57f5a9362ac34af81ef6ff568e2721ee72caaa4b",
      "head_sha": "ecbf70db6e1382dbff198e3a81c36b5f25ba209f",
      "old_path": "backend/pyproject.toml",
      "new_path": "backend/pyproject.toml",
      "position_type": "text",
      "old_line": null,
      "new_line": 56,
      "line_range": null
    },
    "notes": [
      {
        "id": "3381334872",
        "type": "DiffNote",
        "note": "<a href=\"#\"><img alt=\"P2\" src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9\" height=\"20\" align=\"top\"></a> Using a branch name as `rev` makes the `pyproject.toml` entry point at a mutable ref. If anyone force-pushes `avi/ticket-531` or the branch is rebased, `poetry update insta360` would silently pull a different commit. A commit hash here (matching the `resolved_reference` already in the lockfile) makes the source declaration self-consistent and immune to ref-mutation.\n\n```suggestion\ninsta360 = {git = \"https://gitlab.com/whitebox-aero/insta360\", rev = \"8d6fdc4acb176faf2b4449f5be90af59d4390372\"}\n```",
        "note_html": "<p data-sourcepos=\"1:1-1:495\" dir=\"auto\"><a href=\"#\"><img alt=\"P2\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==\" height=\"20\" align=\"top\" data-canonical-src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9\" decoding=\"async\" class=\"lazy\" data-src=\"https://user-content.gitlab-static.net/3aa0b4999a41599367d1cf7221a9cd245da19780/68747470733a2f2f6772657074696c652d7374617469632d6173736574732e73332e616d617a6f6e6177732e636f6d2f6261646765732f70322e7376673f763d39\"></a> Using a branch name as <code data-sourcepos=\"1:151-1:155\">rev</code> makes the <code data-sourcepos=\"1:167-1:182\">pyproject.toml</code> entry point at a mutable ref. If anyone force-pushes <code data-sourcepos=\"1:237-1:252\">avi/ticket-531</code> or the branch is rebased, <code data-sourcepos=\"1:280-1:303\">poetry update insta360</code> would silently pull a different commit. A commit hash here (matching the <code data-sourcepos=\"1:378-1:397\">resolved_reference</code> already in the lockfile) makes the source declaration self-consistent and immune to ref-mutation.</p>\n<div class=\"gl-relative markdown-code-block js-markdown-code\"><pre data-sourcepos=\"3:1-5:3\" data-canonical-lang=\"suggestion\" class=\"code highlight js-syntax-highlight language-suggestion\" v-pre=\"true\"><code class=\"js-render-suggestion\"><span id=\"LC1\" class=\"line\" lang=\"suggestion\">insta360 = {git = \"https://gitlab.com/whitebox-aero/insta360\", rev = \"8d6fdc4acb176faf2b4449f5be90af59d4390372\"}</span></code></pre></div>",
        "system": false,
        "noteable_type": "MergeRequest",
        "noteable_id": 488567980,
        "noteable_iid": 272,
        "project_id": 56243493,
        "noteable_note_url": "https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272#note_3381334872",
        "created_at": "2026-05-25T08:20:46.148Z",
        "updated_at": "2026-05-26T09:00:41.330Z",
        "author": {
          "id": 37628862,
          "username": "group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b",
          "bot": true,
          "user_type": "project_bot"
        }
      }
    ]
  },
  {
    "id": "9e446807b56cb6648cf307039c21ab1b4b65dcef",
    "resolvable": true,
    "resolved": true,
    "diff_discussion": true,
    "active": false,
    "position": {
      "base_sha": "57f5a9362ac34af81ef6ff568e2721ee72caaa4b",
      "start_sha": "57f5a9362ac34af81ef6ff568e2721ee72caaa4b",
      "head_sha": "ecbf70db6e1382dbff198e3a81c36b5f25ba209f",
      "old_path": "backend/pyproject.toml",
      "new_path": "backend/pyproject.toml",
      "position_type": "text",
      "old_line": null,
      "new_line": 56,
      "line_range": null
    },
    "notes": [
      {
        "id": "3381334884",
        "type": "DiffNote",
        "note": "<a href=\"#\"><img alt=\"P2\" src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9\" height=\"20\" align=\"top\"></a> **Implementation not visible in this PR's diff**\n\nThe PR title and description describe a parallel HTTP range-request implementation inside `Client.download_file`, but the only changes in this PR are dependency management files. The actual implementation lives in the `insta360` package on the `avi/ticket-531` branch (resolved commit `8d6fdc4`). Reviewers who want to audit the download logic — worker count, abort-event semantics, `.part` sidecar cleanup on failure, range math — need to review that branch separately.",
        "note_html": "<p data-sourcepos=\"1:1-1:175\" dir=\"auto\"><a href=\"#\"><img alt=\"P2\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==\" height=\"20\" align=\"top\" data-canonical-src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9\" decoding=\"async\" class=\"lazy\" data-src=\"https://user-content.gitlab-static.net/3aa0b4999a41599367d1cf7221a9cd245da19780/68747470733a2f2f6772657074696c652d7374617469632d6173736574732e73332e616d617a6f6e6177732e636f6d2f6261646765732f70322e7376673f763d39\"></a> <strong data-sourcepos=\"1:128-1:175\">Implementation not visible in this PR's diff</strong></p>\n<p data-sourcepos=\"3:1-3:474\" dir=\"auto\">The PR title and description describe a parallel HTTP range-request implementation inside <code data-sourcepos=\"3:91-3:112\">Client.download_file</code>, but the only changes in this PR are dependency management files. The actual implementation lives in the <code data-sourcepos=\"3:219-3:228\">insta360</code> package on the <code data-sourcepos=\"3:245-3:260\">avi/ticket-531</code> branch (resolved commit <code data-sourcepos=\"3:286-3:294\">8d6fdc4</code>). Reviewers who want to audit the download logic — worker count, abort-event semantics, <code data-sourcepos=\"3:386-3:392\">.part</code> sidecar cleanup on failure, range math — need to review that branch separately.</p>",
        "system": false,
        "noteable_type": "MergeRequest",
        "noteable_id": 488567980,
        "noteable_iid": 272,
        "project_id": 56243493,
        "noteable_note_url": "https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272#note_3381334884",
        "created_at": "2026-05-25T08:20:46.443Z",
        "updated_at": "2026-05-26T09:00:41.706Z",
        "author": {
          "id": 37628862,
          "username": "group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b",
          "bot": true,
          "user_type": "project_bot"
        }
      }
    ]
  },
  {
    "id": "86139bc64835024db7c3a6494f655c161841e7c1",
    "resolvable": true,
    "resolved": true,
    "diff_discussion": true,
    "active": true,
    "position": {
      "base_sha": "12241363ad548b496b4e67f0566638d92a9b021a",
      "start_sha": "12241363ad548b496b4e67f0566638d92a9b021a",
      "head_sha": "5da09f9e31ad0d59c6f804a71380992955d1040f",
      "old_path": "backend/poetry.lock",
      "new_path": "backend/poetry.lock",
      "position_type": "text",
      "old_line": 3739,
      "new_line": 3739,
      "line_range": null
    },
    "notes": [
      {
        "id": "3384406925",
        "type": "DiffNote",
        "note": "<a href=\"#\"><img alt=\"P1\" src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg?v=9\" height=\"20\" align=\"top\"></a> **Missing transitive dependency for git-sourced plugin**\n\nThe old `whitebox-plugin-device-insta360 0.1.28` lockfile entry explicitly declared `insta360 = \">=0.1.16,<0.2.0\"` as a dependency. The new git-sourced entry has no `[package.dependencies]` section at all. Because `insta360` is now only in `plugins-temporary`, any install that uses the `plugins-core` group without also activating `plugins-temporary` will pull in the git version of `whitebox-plugin-device-insta360` but never install `insta360`, causing an `ImportError` at plugin load time.\n\nIf the sandbox install script (`curl … | sudo bash`) does not pass `--with plugins-temporary` to `poetry install`, the sandbox deploy from this branch will silently break the Insta360 plugin.",
        "note_html": "<p data-sourcepos=\"1:1-1:183\" dir=\"auto\"><a href=\"#\"><img alt=\"P1\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==\" height=\"20\" align=\"top\" data-canonical-src=\"https://greptile-static-assets.s3.amazonaws.com/badges/p1.svg?v=9\" decoding=\"async\" class=\"lazy\" data-src=\"https://user-content.gitlab-static.net/3e422c6ff64b85a555c82d14362e3f720d8b1c77/68747470733a2f2f6772657074696c652d7374617469632d6173736574732e73332e616d617a6f6e6177732e636f6d2f6261646765732f70312e7376673f763d39\"></a> <strong data-sourcepos=\"1:128-1:183\">Missing transitive dependency for git-sourced plugin</strong></p>\n<p data-sourcepos=\"3:1-3:493\" dir=\"auto\">The old <code data-sourcepos=\"3:9-3:48\">whitebox-plugin-device-insta360 0.1.28</code> lockfile entry explicitly declared <code data-sourcepos=\"3:85-3:114\">insta360 = \"&gt;=0.1.16,&lt;0.2.0\"</code> as a dependency. The new git-sourced entry has no <code data-sourcepos=\"3:166-3:189\">[package.dependencies]</code> section at all. Because <code data-sourcepos=\"3:215-3:224\">insta360</code> is now only in <code data-sourcepos=\"3:241-3:259\">plugins-temporary</code>, any install that uses the <code data-sourcepos=\"3:288-3:301\">plugins-core</code> group without also activating <code data-sourcepos=\"3:333-3:351\">plugins-temporary</code> will pull in the git version of <code data-sourcepos=\"3:385-3:417\">whitebox-plugin-device-insta360</code> but never install <code data-sourcepos=\"3:437-3:446\">insta360</code>, causing an <code data-sourcepos=\"3:460-3:472\">ImportError</code> at plugin load time.</p>\n<p data-sourcepos=\"5:1-5:193\" dir=\"auto\">If the sandbox install script (<code data-sourcepos=\"5:32-5:53\">curl … | sudo bash</code>) does not pass <code data-sourcepos=\"5:70-5:95\">--with plugins-temporary</code> to <code data-sourcepos=\"5:100-5:115\">poetry install</code>, the sandbox deploy from this branch will silently break the Insta360 plugin.</p>",
        "system": false,
        "noteable_type": "MergeRequest",
        "noteable_id": 488567980,
        "noteable_iid": 272,
        "project_id": 56243493,
        "noteable_note_url": "https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272#note_3384406925",
        "created_at": "2026-05-26T08:58:09.914Z",
        "updated_at": "2026-06-17T02:31:43.289Z",
        "author": {
          "id": 37628862,
          "username": "group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b",
          "bot": true,
          "user_type": "project_bot"
        }
      }
    ]
  }
] as const;

function parsed() { return parseGitLabDiscussions(records, subject, scope); }
function first() {
  const value = parsed();const comment = value.threads[0]?.comments[0];const evidence = comment === undefined ? undefined : value.renderedNotes.get(comment.id);
  if (comment === undefined || evidence === undefined) throw new Error('Missing observed rendered note fixture.');
  return { value, comment, evidence };
}
function host(): HTMLElement { const node = document.createElement('div');node.dataset.geldUi = '';node.textContent = 'Safe raw fallback';document.body.append(node);return node; }
function mountNative(comment: ProviderReviewComment, text = 'Live native words'): HTMLElement {
  const root = document.createElement('div');root.id = comment.anchor;root.dataset.testid = 'noteable-note-container';
  root.innerHTML = `<div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="${comment.author.id}" data-username="${comment.author.login}">Original author</a></div></div><div class="note-body"><div class="note-text md"><p>${text}</p></div></div></div></div>`;document.body.append(root);return root;
}
beforeEach(() => {
  window.location.href = URL;document.body.innerHTML = `<div id="js-vue-mr-discussions" data-noteable-type="MergeRequest" data-noteable-data='{"diff_head_sha":"${HEAD}"}'></div>`;
});
afterEach(() => { document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks(); });

describe('same-response rendered note provenance', () => {
  it('retains the three observed HTML bodies separately while semantic items and publication fingerprints stay identical', async () => {
    const value = parsed();expect(value.renderedNotes.size).toBe(3);
    const input: ProviderReviewInput = { subject, threads: value.threads, complete: true };
    const raw = structuredClone(input);const items = buildProviderReviewItems(input);const publication = await createNativePublication(input, items);
    for (const thread of value.threads) for (const comment of thread.comments) {
      const target = host();expect(document.getElementById(comment.anchor)).toBeNull();
      expect(renderGitLabComment(comment, target, document, value.renderedNotes.get(comment.id))).toBe(true);
      expect(target.querySelector('.note-text.md[data-geld-rendered-source="api"]')).not.toBeNull();
      // Retained native .note-text roots have no dir; GitLab supplies dir="auto" on its rendered paragraphs.
      expect(target.querySelector('.note-text')?.getAttribute('dir')).toBeNull();
      expect([...target.querySelectorAll('p')].map((paragraph) => paragraph.getAttribute('dir'))).not.toContain(null);
      expect([...target.querySelectorAll('p')].every((paragraph) => paragraph.getAttribute('dir') === 'auto')).toBe(true);
      expect(target.querySelector('p code')).not.toBeNull();expect(target.textContent).not.toContain('<a href=');
      expect(target.querySelector('img,[id],[data-testid],[data-src],[data-canonical-src],[data-sourcepos],button,svg')).toBeNull();
      if (comment.id === '3381334884') expect(target.querySelector('strong')?.textContent).toBe("Implementation not visible in this PR's diff");
      if (comment.id === '3384406925') expect(target.querySelector('strong')?.textContent).toBe('Missing transitive dependency for git-sourced plugin');
    }
    const concern = document.querySelector('[data-geld-rendered-source="api"]');
    expect(concern?.querySelector('pre.code code')?.textContent).toContain('rev = "8d6fdc4acb176faf2b4449f5be90af59d4390372"');
    expect(concern?.textContent).toContain('P2 Using a branch name as rev');
    expect(input).toEqual(raw);expect(buildProviderReviewItems(input)).toEqual(items);expect(await createNativePublication(input, items)).toEqual(publication);
    expect(value.threads.map((thread) => [thread.resolved, thread.outdated])).toEqual([[true, true], [true, true], [true, false]]);
  });

  it.each(['missing scope', 'wrong project', 'wrong MR', 'wrong IID', 'wrong type', 'unknown system flag', 'foreign URL', 'wrong note anchor', 'missing HTML', 'non-string HTML', 'empty HTML', 'oversize HTML'])('omits only optional presentation for %s', (condition) => {
    const record = records[0].notes[0];let extra: Readonly<Record<string, unknown>> = {};
    if (condition === 'wrong project') extra = { project_id: 123 };
    if (condition === 'wrong MR') extra = { noteable_id: 123 };
    if (condition === 'wrong IID') extra = { noteable_iid: 273 };
    if (condition === 'wrong type') extra = { noteable_type: 'Issue' };
    if (condition === 'unknown system flag') extra = { system: undefined };
    if (condition === 'foreign URL') extra = { noteable_note_url: 'https://other.example/note' };
    if (condition === 'wrong note anchor') extra = { noteable_note_url: `${URL}#note_1` };
    if (condition === 'missing HTML') extra = { note_html: undefined };
    if (condition === 'non-string HTML') extra = { note_html: 123 };
    if (condition === 'empty HTML') extra = { note_html: '   ' };
    if (condition === 'oversize HTML') extra = { note_html: 'x'.repeat(256 * 1024 + 1) };
    const source = [{ ...records[0], notes: [{ ...record, ...extra }] }];
    const value = parseGitLabDiscussions(source, subject, condition === 'missing scope' ? undefined : scope);
    expect(value.renderedNotes.size).toBe(0);expect(value.threads[0]?.comments[0]?.body).toBe(record.note);
  });

  it('captures raw tuple values independently of later snapshot object mutation', () => {
    const { comment, evidence } = first();Object.defineProperty(comment, 'body', { value: 'New raw source words' });
    expect(evidence.comment.body).not.toBe(comment.body);const target = host();
    expect(renderGitLabComment(comment, target, document, evidence)).toBe(false);expect(target.textContent).toBe('Safe raw fallback');
  });

  it('bounds aggregate optional HTML without dropping raw discussion sources', () => {
    const notes = Array.from({ length: 5 }, (_, index) => ({ ...records[0].notes[0], id: String(800 + index), noteable_note_url: `${URL}#note_${800 + index}`, note_html: 'x'.repeat(256 * 1024) }));
    const value = parseGitLabDiscussions([{ ...records[0], notes }], subject, scope);
    expect(value.renderedNotes.size).toBe(4);expect(value.threads[0]?.comments).toHaveLength(5);
  });
});

describe('absent-only inert rendered fallback', () => {
  it.each(['body', 'createdAt', 'updatedAt', 'author id', 'author login', 'author flag', 'note id', 'note anchor', 'permalink'])('rejects a changed %s tuple without interpreting raw Markdown', (condition) => {
    const { comment, evidence } = first();let changed = comment;
    if (condition === 'body') changed = { ...comment, body: 'Edited' };
    if (condition === 'createdAt') changed = { ...comment, createdAt: '2026-05-25T09:00:00Z' };
    if (condition === 'updatedAt') changed = { ...comment, updatedAt: '2026-06-18T00:00:00Z' };
    if (condition === 'author id') changed = { ...comment, author: { ...comment.author, id: '999' } };
    if (condition === 'author login') changed = { ...comment, author: { ...comment.author, login: 'greptile-apps[bot]' } };
    if (condition === 'author flag') changed = { ...comment, author: { ...comment.author, automated: false } };
    if (condition === 'note id') changed = { ...comment, id: '1', anchor: 'note_1', url: `${URL}#note_1` };
    if (condition === 'note anchor') changed = { ...comment, anchor: 'note_1' };
    if (condition === 'permalink') changed = { ...comment, url: `${URL}#note_1` };
    const target = host();expect(renderGitLabComment(changed, target, document, evidence)).toBe(false);expect(target.textContent).toBe('Safe raw fallback');
  });

  it.each(['provider', 'origin', 'repository', 'review', 'head', 'navigation'])('rejects a changed %s subject', (condition) => {
    const { comment, evidence } = first();let changed: GitLabRenderedNote = evidence;
    if (condition === 'provider') changed = { ...evidence, subject: { ...subject, provider: 'bitbucket' } };
    if (condition === 'origin') changed = { ...evidence, subject: { ...subject, origin: 'https://other.example' } };
    if (condition === 'repository') changed = { ...evidence, subject: { ...subject, repository: 'other/repo' } };
    if (condition === 'review') changed = { ...evidence, subject: { ...subject, id: '273' } };
    if (condition === 'head') changed = { ...evidence, subject: { ...subject, headSha: 'a'.repeat(40) } };
    if (condition === 'navigation') window.location.href = URL.replace('/272', '/273');
    const target = host();expect(renderGitLabComment(comment, target, document, changed)).toBe(false);expect(target.textContent).toBe('Safe raw fallback');
  });

  it('uses captured full-head API evidence when an overview has no native head attribute', () => {
    const { comment, evidence } = first();document.getElementById('js-vue-mr-discussions')?.remove();
    expect(renderGitLabComment(comment, host(), document, evidence)).toBe(true);
  });

  it('prefers late mounted valid native markup and returns to the matching fallback after unmount', () => {
    const { comment, evidence } = first();const target = host();expect(renderGitLabComment(comment, target, document, evidence)).toBe(true);
    const native = mountNative(comment);const original = native.outerHTML;expect(renderGitLabComment(comment, target, document, evidence)).toBe(true);
    expect(target.textContent).toBe('Live native words');expect(target.querySelector('[data-geld-rendered-source]')).toBeNull();expect(native.outerHTML).toBe(original);
    native.remove();expect(renderGitLabComment(comment, target, document, evidence)).toBe(true);expect(target.textContent).toContain('Using a branch name as rev');
  });

  it.each(['duplicate', 'wrong author', 'wrong username', 'missing body', 'duplicate body', 'owned source', 'description source'])('does not mask %s live source with API presentation', (condition) => {
    const { comment, evidence } = first();const native = mountNative(comment);
    if (condition === 'duplicate') document.body.append(native.cloneNode(true));
    if (condition === 'wrong author') native.querySelector('.author-name-link')?.setAttribute('data-user-id', '999');
    if (condition === 'wrong username') native.querySelector('.author-name-link')?.setAttribute('data-username', 'another');
    if (condition === 'missing body') native.querySelector('.note-text')?.remove();
    if (condition === 'duplicate body') { const body = document.createElement('div');body.classList.add('note-text');native.querySelector('.note-body')?.append(body); }
    if (condition === 'owned source') native.dataset.geldUi = '';
    if (condition === 'description source') { const wrapper = document.createElement('section');wrapper.dataset.testid = 'description-content';native.replaceWith(wrapper);wrapper.append(native); }
    const target = host();expect(renderGitLabComment(comment, target, document, evidence)).toBe(false);expect(target.textContent).toBe('Safe raw fallback');
  });

  it('drops resources, controls, positioning classes and hooks while retaining inert code and authored words', () => {
    const { comment, evidence } = first();const target = host();const fetch = vi.spyOn(globalThis, 'fetch');
    const html = '<p id="note_123" onclick="attack()" style="position:fixed" class="gl-fixed js-hook" data-testid="noteable-note-container">Words <strong>kept</strong><img src="https://outside.invalid/pixel" data-src="https://outside.invalid/hydrate" alt="P2"></p><div class="markdown-code-block gl-absolute"><pre class="code highlight language-suggestion js-hook"><code><span id="LC1" class="line" lang="suggestion">fix()</span></code></pre></div><script>attack()</script><form><button>Post</button></form><iframe src="https://outside.invalid/frame"></iframe><style>body{display:none}</style>';
    expect(renderGitLabComment(comment, target, document, { ...evidence, html })).toBe(true);
    expect(target.textContent).toBe('Words keptP2fix()');expect(target.querySelector('pre.code.highlight.language-suggestion .line')?.textContent).toBe('fix()');
    expect(target.querySelector('img,iframe,script,style,form,button,[id],[style],[onclick],[data-src],[data-testid],.gl-fixed,.gl-absolute,.js-hook')).toBeNull();expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['empty', 'only controls', 'too deep', 'too many nodes'])('retains honest raw fallback when rendered content is %s', (condition) => {
    const { comment, evidence } = first();let html = '';
    if (condition === 'only controls') html = '<script>attack()</script><button>Post</button>';
    if (condition === 'too deep') html = '<div>'.repeat(70) + 'Words' + '</div>'.repeat(70);
    if (condition === 'too many nodes') html = '<span>x</span>'.repeat(6000);
    const target = host();expect(renderGitLabComment(comment, target, document, { ...evidence, html })).toBe(false);expect(target.textContent).toBe('Safe raw fallback');
  });
});

describe('rendered source acquisition', () => {
  it.each([true, false])('binds presentation only to independently fetched matching MR/project metadata: %s', async (validScope) => {
    const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: subject.origin, path: subject.repository }, kind: 'overview', number: subject.id, headSha: HEAD, version: HEAD, url: URL, diffPageUrl: `${URL}/diffs`, diffUrl: `${URL}.diff` };
    const fetch = vi.fn(async (request: string | URL | Request) => {
      const url = new globalThis.URL(typeof request === 'string' ? request : request instanceof globalThis.URL ? request : request.url);
      const response = url.pathname.endsWith('/discussions.json') ? records : url.pathname.endsWith('/approvals') ? { approved_by: [] }
        : url.pathname.endsWith('/reviewers') || url.pathname.endsWith('/pipelines') ? []
          : { id: validScope ? Number(scope.noteableId) : 123, project_id: Number(scope.projectId), iid: 272, sha: HEAD, state: 'merged', web_url: URL };
      return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
    });vi.stubGlobal('fetch', fetch);
    const value = await fetchGitLabReview(page, new AbortController().signal);
    expect(value.renderedNotes.size).toBe(validScope ? 3 : 0);expect(value.input.threads.flatMap((thread) => thread.comments)).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(6);expect(fetch.mock.calls.filter(([request]) => String(request).includes('/discussions.json'))).toHaveLength(1);
    expect(value.input.threads[0]?.comments[0]).not.toHaveProperty('html');expect(value.input.threads[0]?.comments[0]?.body).toBe(records[0].notes[0].note);
  });
});
