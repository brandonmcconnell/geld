import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { GITLAB_COPY_AUTHOR, GITLAB_COPY_FIX, GITLAB_COPY_MARKDOWN, gitLabCopyFixOf, verifyGitLabItemCopies } from './item-copy-acceptance.mjs';

const REVIEW = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
function protocol(options = {}) {
  const page = new EventEmitter();let clipboard = '';let event;let kind;let snapshots = 0;let permissionsCleared = 0;
  const item = {};
  const state = () => ({ state: 'resolved', sources: ['note_3381334872', 'note_3381334884'].map((anchor) => ({ anchor, body: 'Retained source body', links: [`${REVIEW}#${anchor}`] })), nativeSummary: '<p>Native summary</p>', sameNative: !options.replaced || ++snapshots === 1 });
  page.url = () => REVIEW;page.isClosed = () => false;
  page.evaluate = async (fn, ...args) => {
    const source = fn.toString();
    if (source.includes('row?.getAttribute')) return 'ri_native';
    if (source.includes('nativeSummary:')) return state();
    if (source.includes('navigator.clipboard.writeText')) { clipboard = args[0];return; }
    if (source.includes('navigator.clipboard.readText')) return clipboard;
    if (source.includes('delete globalThis')) return;
    if (source.includes('return globalThis.__geldCopyInput') || source.includes('() => globalThis.__geldCopyInput')) return event;
    if (source.includes('globalThis.__geldCopyNative =')) return;
    throw new Error(`Unexpected synthetic protocol evaluation: ${source}`);
  };
  const activate = () => {
    event = { trusted: options.untrusted !== true, detail: kind === 'fix' ? 1 : 0 };
    clipboard = options.wrongClipboard ? 'Wrong bytes' : kind === 'fix' ? GITLAB_COPY_FIX : GITLAB_COPY_MARKDOWN;
    if (options.sourceGet) page.emit('request', { method: () => 'GET', url: () => `${REVIEW}/discussions.json` });
  };
  page.$ = async (selector) => {
    kind = selector.includes('="fix"') ? 'fix' : 'markdown';
    return { evaluate: async () => {}, click: async () => activate(), focus: async () => {}, dispose: async () => {} };
  };
  page.keyboard = { press: async (key) => { assert.equal(key, 'Enter');activate(); } };
  const context = { overridePermissions: async (origin, permissions) => { assert.equal(origin, 'https://gitlab.com');assert.deepEqual(permissions, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);if (options.denied) throw new Error('Permission unavailable'); }, clearPermissionOverrides: async () => { permissionsCleared += 1; } };
  return { item, cleared: () => permissionsCleared, run: () => verifyGitLabItemCopies(page, item, { context, expectedFix: GITLAB_COPY_FIX, expectedAuthor: GITLAB_COPY_AUTHOR, safeUrl: (value) => value, openReviewAncestors: async () => 2,
    poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value), 'Exact clipboard readback required');return value; },
  }) };
}

test('the observed fixture suggestion is read without interpreting raw HTML or fetching another source', () => {
  assert.equal(gitLabCopyFixOf(`<img src=x>\n\n\`\`\`suggestion\n${GITLAB_COPY_FIX}\n\`\`\``), GITLAB_COPY_FIX);
  assert.equal(gitLabCopyFixOf('No suggestion'), null);
  assert.equal(gitLabCopyFixOf('```suggestion\n' + 'x'.repeat(4097) + '\n```'), null);
});

test('synthetic protocol checks require trusted input, exact two readbacks, unchanged source and permission cleanup', async () => {
  const f = protocol();const result = await f.run();
  assert.equal(result.status, 'passed');assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions.map((action) => action.input), ['pointer', 'keyboard']);
  assert.equal(result.actions[0].copied, GITLAB_COPY_FIX);assert.equal(result.actions[1].copied, GITLAB_COPY_MARKDOWN);
  assert.equal(f.cleared(), 1);assert.equal(result.permissionsRestored, true);
});

for (const [name, options] of [['untrusted click', { untrusted: true }], ['wrong clipboard bytes', { wrongClipboard: true }], ['replaced native node', { replaced: true }], ['unexpected source GET', { sourceGet: true }], ['permission denial', { denied: true }]]) test(`synthetic acceptance rejects ${name} and restores permission overrides`, async () => {
  const f = protocol(options);await assert.rejects(f.run());
  assert.equal(f.item.itemCopies.status, 'failed');assert.equal(f.cleared(), 1);
});
