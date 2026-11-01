import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  insertCSS: vi.fn(async () => undefined),
  executeScript: vi.fn(async () => undefined),
  sendMessage: vi.fn(async (): Promise<unknown> => { throw new Error('No receiver'); }),
  legacyCSS: vi.fn(async () => undefined),
  legacyScript: vi.fn(async () => undefined),
}));

vi.mock('wxt/browser', () => ({ browser: {
  scripting: { insertCSS: api.insertCSS, executeScript: api.executeScript },
  tabs: { sendMessage: api.sendMessage, insertCSS: api.legacyCSS, executeScript: api.legacyScript },
} }));
vi.mock('./diagnostics', () => ({ recordDiagnostic: vi.fn(), tabSubject: vi.fn(() => 'test repository') }));

import { ensureContentScript, injectContentScript } from './inject';

beforeEach(() => {
  vi.clearAllMocks();
  api.sendMessage.mockImplementation(async () => { throw new Error('No receiver'); });
});

describe('provider content injection', () => {
  it.each(['gitlab', 'bitbucket'] as const)('injects only %s files in MV3', async (provider) => {
    await injectContentScript(7, provider, 3);
    expect(api.insertCSS).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [`/content-scripts/${provider}.css`] });
    expect(api.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 7 }, files: [`/content-scripts/${provider}.js`] });
    expect(api.legacyScript).not.toHaveBeenCalled();
  });

  it('keeps the GitHub portal confined to GitHub injection', async () => {
    await injectContentScript(7, 'github', 3);
    expect(api.executeScript).toHaveBeenCalledTimes(2);
    expect(api.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 7 }, files: ['/content-scripts/portal.js'], world: 'MAIN' });
  });

  it('requires explicit enterprise routing and rejects mismatched cloud providers', async () => {
    expect(await ensureContentScript(7, { reason: 'popup', url: 'https://ghe.example/acme/widgets' })).toBe(false);
    expect(await ensureContentScript(7, { reason: 'popup', url: 'https://gitlab.com/acme/widgets/-/merge_requests/1', provider: 'github' })).toBe(false);
    expect(await ensureContentScript(7, { reason: 'popup', url: 'http://github.com/acme/widgets', provider: 'github' })).toBe(false);
    expect(api.executeScript).not.toHaveBeenCalled();
    expect(await ensureContentScript(7, { reason: 'popup', url: 'https://ghe.example/acme/widgets', provider: 'github' })).toBe(true);
  });

  it('does not replace an already answering provider script', async () => {
    api.sendMessage.mockResolvedValue({ repo: 'acme/widgets', repoConfig: null, allowed: true, hasDiff: false, hiddenCount: 0, categories: [], expanded: false, diffPageUrl: null, onDiffPage: false });
    expect(await ensureContentScript(7, { reason: 'popup', url: 'https://bitbucket.org/acme/widgets/pull-requests/1' })).toBe(false);
    expect(api.executeScript).not.toHaveBeenCalled();
  });

  it('routes the same provider files through Firefox MV2 APIs', async () => {
    await injectContentScript(7, 'gitlab', 2);
    expect(api.legacyCSS).toHaveBeenCalledWith(7, { file: '/content-scripts/gitlab.css', runAt: 'document_start' });
    expect(api.legacyScript).toHaveBeenCalledExactlyOnceWith(7, { file: '/content-scripts/gitlab.js', runAt: 'document_start' });
    expect(api.executeScript).not.toHaveBeenCalled();
  });

  it.each([
    ['https://gitlab.com/acme/widgets/-/merge_requests/1', 'gitlab'],
    ['https://bitbucket.org/acme/widgets/pull-requests/1', 'bitbucket'],
    ['https://github.com/acme/widgets/pull/1', 'github'],
  ])('selects the correct provider for a missing receiver on %s', async (url, provider) => {
    expect(await ensureContentScript(7, { reason: 'popup', url })).toBe(true);
    expect(api.legacyScript).toHaveBeenCalledWith(7, { file: `/content-scripts/${provider}.js`, runAt: 'document_start' });
  });
});
