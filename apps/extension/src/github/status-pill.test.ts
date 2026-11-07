// @vitest-environment happy-dom
import type { MergeBox } from './merge-actions';
import { labelBehind, showMergedPills, statusOptions, syncStatusPills } from './status-pill';
import { ICON_GIT_MERGE, ICON_GIT_PULL_REQUEST } from './ui/icons';

const box = (over: Partial<MergeBox>): MergeBox => ({
  state: 'OPEN',
  open: true,
  draft: false,
  canClose: false,
  canConvertToDraft: false,
  canMarkReady: false,
  verdicts: [],
  mergeable: false,
  canBypass: false,
  unbypassable: false,
  methods: ['MERGE'],
  bypassMethods: ['MERGE'],
  commitTitle: '',
  commitMessage: '',
  authorEmail: null,
  stacked: false,
  canQueue: false,
  canAutoMerge: false,
  queued: false,
  autoMerging: false,
  ...over,
});

describe('statusOptions', () => {
  it('lists the statuses the reader may switch to, forward first and closed last, in GitHub’s words', () => {
    expect(statusOptions(box({ canClose: true, canConvertToDraft: true }), 'bypass').map((option) => [option.status, option.action, option.note])).toEqual([
      ['merged', 'merge', 'Bypass rules and merge'],
      ['draft', 'draft', 'Convert to draft'],
      ['closed', 'close', 'Close pull request'],
    ]);
    expect(statusOptions(box({ canClose: true }), 'merge').map((option) => option.note)).toEqual(['Create a merge commit', 'Close pull request']);
  });

  it('offers nothing where the reader may change nothing, and never on a merged pull request', () => {
    expect(statusOptions(box({}), null)).toEqual([]);
    expect(statusOptions(box({ state: 'MERGED', open: false, canClose: true }), null)).toEqual([]);
    expect(statusOptions(box({ state: null }), 'merge')).toEqual([]);
  });

  it('offers a merge queue’s Merge when ready where a merge would stand, before a draft and closing', () => {
    expect(statusOptions(box({ canClose: true, canConvertToDraft: true, methods: [], canQueue: true }), 'queue').map((option) => [option.status, option.action, option.note])).toEqual([
      ['queued', 'queue', 'Merge when ready'],
      ['draft', 'draft', 'Convert to draft'],
      ['closed', 'close', 'Close pull request'],
    ]);
  });

  it('offers auto-merge where a merge would stand while the pull request waits on its requirements', () => {
    expect(statusOptions(box({ canClose: true, canAutoMerge: true }), 'auto').map((option) => [option.status, option.action, option.note])).toEqual([
      ['merged', 'auto', 'Enable auto-merge'],
      ['closed', 'close', 'Close pull request'],
    ]);
  });

  it('lists an admin’s bypass right after the queue or auto-merge it stands beside', () => {
    expect(statusOptions(box({ canClose: true, canConvertToDraft: true, canQueue: true }), 'queue', true).map((option) => [option.status, option.action, option.note, option.bypass === true])).toEqual([
      ['queued', 'queue', 'Merge when ready', false],
      ['merged', 'merge', 'Bypass rules and merge', true],
      ['draft', 'draft', 'Convert to draft', false],
      ['closed', 'close', 'Close pull request', false],
    ]);
    expect(statusOptions(box({ canAutoMerge: true }), 'auto', true).map((option) => option.note)).toEqual(['Enable auto-merge', 'Bypass rules and merge']);
    expect(statusOptions(box({ draft: true, canMarkReady: true }), null, true).map((option) => option.status)).toEqual(['open']);
  });

  it('never offers a draft a merge', () => {
    expect(statusOptions(box({ draft: true, canMarkReady: true }), 'merge').map((option) => option.status)).toEqual(['open']);
  });
});

describe('showMergedPills', () => {
  const glyph = (icon: string, name: string): string => icon.replace(/class="[^"]*"/, `class="octicon ${name} prc-StateLabel-Icon-x"`);
  const react = (status: string, words: string, icon: string, name: string): string =>
    `<div data-component="PageHeader"><span class="prc-StateLabel-x" data-component="StateLabel" data-size="medium" data-status="${status}" title="Status: ${words}">${glyph(icon, name)}${words}</span></div>`;
  const classic = (state: string, words: string, icon: string, name: string): string =>
    `<div class="gh-header-meta"><span class="State State--${state}" title="Status: ${words}">${glyph(icon, name)} ${words}</span></div>`;
  const pillAfterMerge = (markup: string): string => {
    document.body.innerHTML = markup;
    showMergedPills(syncStatusPills(true, () => undefined));
    return document.querySelector('button[data-geld-status-pill]')?.outerHTML ?? '';
  };
  const pillFromGitHub = (markup: string): string => {
    document.body.innerHTML = markup;
    const pill = syncStatusPills(true, () => undefined)[0];
    pill?.removeAttribute('aria-haspopup');
    pill?.removeAttribute('aria-expanded');
    return pill?.outerHTML ?? '';
  };

  it('draws the merged pill as GitHub’s own merged label will dress it, so the reload moves nothing', () => {
    const merged = pillAfterMerge(react('pullOpened', 'Open', ICON_GIT_PULL_REQUEST, 'octicon-git-pull-request'));
    expect(merged).toContain('Merged');
    expect(merged).toContain('geld-status-pill__lead');
    expect(merged).not.toContain('aria-haspopup');
    expect(merged).not.toContain('aria-expanded');
    expect(merged).toBe(pillFromGitHub(react('pullMerged', 'Merged', ICON_GIT_MERGE, 'octicon-git-merge')));
    expect(pillAfterMerge(classic('open', 'Open', ICON_GIT_PULL_REQUEST, 'octicon-git-pull-request'))).toBe(pillFromGitHub(classic('merged', 'Merged', ICON_GIT_MERGE, 'octicon-git-merge')));
  });

  it('stays merged through a pass before the reload, while GitHub’s label still reads open', () => {
    const merged = pillAfterMerge(react('pullOpened', 'Open', ICON_GIT_PULL_REQUEST, 'octicon-git-pull-request'));
    syncStatusPills(true, () => undefined);
    expect(document.querySelector('button[data-geld-status-pill]')?.outerHTML).toBe(merged);
  });
});

describe("the Overview's status label", () => {
  it("is GitHub's own status menu, hidden whole with Geld's pill after it, and given back when Geld steps aside", () => {
    document.body.innerHTML = `<div data-component="PageHeader"><button type="button" aria-haspopup="true" aria-label="Pull request state: Open"><span data-component="StateLabel" data-status="pullOpened">Open</span></button></div>`;
    const github = document.querySelector('button[aria-haspopup="true"]');
    const [pill] = syncStatusPills(true, () => undefined);
    expect(pill?.previousElementSibling).toBe(github);
    expect(pill?.getAttribute('data-status')).toBe('pullOpened');
    expect(github?.hasAttribute('data-geld-status-hidden')).toBe(true);
    expect(github?.querySelector('[data-geld-status-pill]')).toBeNull();
    expect(pill === undefined ? null : labelBehind(pill)).toBe(document.querySelector('[data-component="StateLabel"]'));
    // A second pass keeps the one pill.
    expect(syncStatusPills(true, () => undefined)).toEqual([pill]);
    syncStatusPills(false, () => undefined);
    expect(github?.hasAttribute('data-geld-status-hidden')).toBe(false);
    expect(document.querySelector('[data-geld-status-pill]')).toBeNull();
    document.body.replaceChildren();
  });

  it('is taken over in the mini header too, which stands stuck to the top once the page header scrolls away', () => {
    document.body.innerHTML = `<div data-testid="diff-comparison-viewer-sticky-header-slot"><div class="miniHeaderInner__x"><div class="metadata__x"><button type="button" aria-haspopup="true"><span data-component="StateLabel" data-status="pullOpened" data-size="small">Open</span></button></div></div></div>
      <div data-component="PageHeader"><button type="button" aria-haspopup="true"><span data-component="StateLabel" data-status="pullOpened">Open</span></button></div>`;
    const pills = syncStatusPills(true, () => undefined);
    expect(pills).toHaveLength(2);
    expect(pills[0]?.closest('[data-testid="diff-comparison-viewer-sticky-header-slot"]')).not.toBeNull();
    expect(pills[0]?.getAttribute('data-size')).toBe('small');
    expect([...document.querySelectorAll('button[aria-haspopup="true"]')].every((button) => button.hasAttribute('data-geld-status-hidden'))).toBe(true);
    document.body.replaceChildren();
  });

  it('leaves no pill behind when GitHub swaps its status button for a merged label in place', () => {
    document.body.innerHTML = `<div data-component="PageHeader"><div class="row"><button type="button" aria-haspopup="true" aria-label="Pull request state: Open"><span data-component="StateLabel" data-status="pullOpened">Open</span></button></div></div>`;
    const [pill] = syncStatusPills(true, () => undefined);
    // A merge in place: GitHub drops the button and renders a plain label, after Geld's pill.
    document.querySelector('button[aria-haspopup="true"]')?.remove();
    pill?.after(Object.assign(document.createElement('span'), { textContent: 'Merged' }));
    const merged = document.querySelector('.row > span');
    merged?.setAttribute('data-component', 'StateLabel');
    merged?.setAttribute('data-status', 'pullMerged');
    // Nothing to switch a merged pull request to: GitHub's label alone.
    expect(syncStatusPills(false, () => undefined)).toEqual([]);
    expect(document.querySelectorAll('[data-geld-status-pill]')).toHaveLength(0);
    // Still offered (a merge of Geld's own on its way): one pill, after the new label, dressed from it.
    const [again] = syncStatusPills(true, () => undefined);
    expect(document.querySelectorAll('[data-geld-status-pill]')).toHaveLength(1);
    expect(again?.previousElementSibling).toBe(merged);
    expect(again?.getAttribute('data-status')).toBe('pullMerged');
    document.body.replaceChildren();
  });
});
