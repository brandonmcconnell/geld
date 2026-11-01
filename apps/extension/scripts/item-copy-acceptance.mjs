import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const REVIEW = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
export const GITLAB_COPY_AUTHOR = 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b';
export const GITLAB_COPY_FIX = 'insta360 = {git = "https://gitlab.com/whitebox-aero/insta360", rev = "8d6fdc4acb176faf2b4449f5be90af59d4390372"}';
export const GITLAB_COPY_MARKDOWN = [
  '- [x] **Comment** `backend/pyproject.toml:56` · @group\\_84680077\\_bot\\_800401aaa75115e1bc0c76e02d860b8b',
  '  Source status: resolved.', '  Suggested fix (bot):', '  ```suggestion', `  ${GITLAB_COPY_FIX}`, '  ```',
  `  Sources: [source](${REVIEW}#note_3381334872) · [source](${REVIEW}#note_3381334884)`,
].join('\n');

export function gitLabCopyFixOf(body) {
  const fix = /```suggestion\r?\n([\s\S]*?)```/.exec(body)?.[1]?.replace(/\s+$/, '');
  return fix === undefined || fix.length > 4096 ? null : fix;
}

export async function verifyGitLabItemCopies(page, item, { context, expectedFix, expectedAuthor, openReviewAncestors, poll, safeUrl }) {
  const proof = { status: 'running', sourceGets: [], actions: [], scope: 'Actual browser clipboard and trusted input on one already-fetched native concern. No provider write, new source acquisition or AI request.' };
  item.itemCopies = proof;
  const request = (value) => {
    const url = new URL(value.url());
    if (value.method() === 'GET' && url.origin === 'https://gitlab.com' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/whitebox-aero/whitebox/-/merge_requests/272/') && url.pathname.endsWith('.json')) && proof.sourceGets.length < 12) proof.sourceGets.push(safeUrl(url.href));
  };
  page.on('request', request);
  let permissionAttempted = false;
  try {
    assert.equal(expectedFix, GITLAB_COPY_FIX, 'The independently observed native suggestion changed');
    assert.equal(expectedAuthor, GITLAB_COPY_AUTHOR, 'The independently observed native account changed');
    assert.equal(page.url(), REVIEW);
    proof.openedSummaries = await openReviewAncestors(page, '[data-geld-source="note_3381334872"]');
    const selector = await page.evaluate(() => {
      const source = document.querySelector('article[data-geld-source="note_3381334872"]');
      const row = source?.closest('[data-geld-item]');
      return row?.getAttribute('data-geld-item') ?? null;
    });
    assert.match(selector ?? '', /^ri_[a-zA-Z0-9_-]+$/);
    const row = `[data-geld-item="${selector}"]`;
    await page.evaluate(() => {
      const native = document.getElementById('note_3381334808');
      globalThis.__geldCopyNative = { node: native, parent: native?.parentElement };
    });
    const readSources = () => page.evaluate((row) => ({
      state: document.querySelector(row)?.getAttribute('data-state'),
      sources: [...document.querySelectorAll(`${row} article[data-geld-source]`)].map((node) => ({ anchor: node.getAttribute('data-geld-source'), body: node.querySelector(':scope > .geld-provider-review__body')?.textContent, links: [...node.querySelectorAll(':scope > .geld-provider-review__byline a[href]')].map((link) => link.href) })),
      nativeSummary: document.querySelector('#note_3381334808 .note-body .note-text')?.outerHTML ?? null,
      sameNative: globalThis.__geldCopyNative.node !== null && document.getElementById('note_3381334808') === globalThis.__geldCopyNative.node && globalThis.__geldCopyNative.node.parentElement === globalThis.__geldCopyNative.parent,
    }), row);
    proof.before = await readSources();
    assert.equal(proof.before.state, 'resolved');
    assert.deepEqual(proof.before.sources.map((source) => source.anchor), ['note_3381334872', 'note_3381334884']);
    assert.equal(typeof proof.before.nativeSummary, 'string');
    assert.equal(proof.before.sameNative, true);
    permissionAttempted = true;await context.overridePermissions('https://gitlab.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    proof.permissions = { origin: 'https://gitlab.com', permissions: ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'] };
    const sentinel = `geld-clipboard-baseline-${randomUUID()}`;
    await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sentinel);
    for (const [kind, expected, input] of [['fix', GITLAB_COPY_FIX, 'pointer'], ['markdown', GITLAB_COPY_MARKDOWN, 'keyboard']]) {
      assert.equal(page.url(), REVIEW);
      const target = `${row} button[data-geld-copy-kind="${kind}"]`;
      const handle = await page.$(target);assert.ok(handle !== null, `Missing eligible ${kind} copy control`);
      try {
        await handle.evaluate((button) => {
          button.scrollIntoView({ block: 'center', inline: 'nearest' });
          globalThis.__geldCopyInput = null;
          button.addEventListener('click', (event) => { globalThis.__geldCopyInput = { trusted: event.isTrusted, detail: event.detail }; }, { capture: true, once: true });
        });
        if (input === 'pointer') await handle.click();
        else { await handle.focus();await page.keyboard.press('Enter'); }
        const event = await page.evaluate(() => globalThis.__geldCopyInput);
        assert.equal(event?.trusted, true, 'Clipboard acceptance requires genuine browser input');
        if (input === 'keyboard') assert.equal(event.detail, 0);
        const copied = await poll(() => page.evaluate(() => navigator.clipboard.readText()), (text) => text === expected, `Exact browser clipboard ${kind} readback`, 8000);
        assert.equal(page.url(), REVIEW);
        proof.actions.push({ kind, input, event, copied, expectedMatched: true });
      } finally { await handle.dispose(); }
    }
    proof.after = await readSources();assert.deepEqual(proof.after, proof.before, 'Copy actions changed native/source words, links or state');
    assert.deepEqual(proof.sourceGets, [], 'Clipboard acceptance must reuse the already fetched concern');
    proof.status = 'passed';return proof;
  } catch (error) {
    proof.status = 'failed';proof.error = error instanceof Error ? error.message : String(error);throw error;
  } finally {
    page.off('request', request);
    try {
      if (!page.isClosed()) await page.evaluate(() => { delete globalThis.__geldCopyInput;delete globalThis.__geldCopyNative; });
    } finally {
      if (permissionAttempted) {
        try { await context.clearPermissionOverrides();proof.permissionsRestored = true; }
        catch (error) { proof.status = 'failed';proof.cleanupError = error instanceof Error ? error.message : String(error);throw error; }
      }
    }
  }
}
