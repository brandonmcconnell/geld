// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviderReviewItems, providerReviewKey } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, ProviderReviewThread } from '@geld/review';
import type { ProviderAiState } from './ai';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewAuthorPresentation, ProviderReviewPanelEvent } from './review-panel';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/project', id: '42', headSha: 'a'.repeat(40) } as const;
const reviewUrl = 'https://gitlab.com/group/subgroup/project/-/merge_requests/42';

function comment(id: string, body = 'Check the response before reading it.'): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${reviewUrl}#note_${id}`, author: { id: 'user-1', login: 'alice' }, body, createdAt: '2026-11-01T12:00:00Z' };
}

function thread(id: string, overrides: Partial<ProviderReviewThread> = {}): ProviderReviewThread {
  return { id: id.repeat(40), anchor: `discussion_${id.repeat(40)}`, url: `${reviewUrl}#note_${id === 'b' ? '2' : '1'}`, path: `${id}.ts`, resolved: false, outdated: false, comments: [comment(id === 'b' ? '2' : '1')], ...overrides };
}

function input(threads: readonly ProviderReviewThread[] = []): ProviderReviewInput {
  return { subject, threads, reviewers: [], checks: [] };
}

function host(): HTMLElement {
  const value = document.createElement('div');
  document.body.append(value);
  return value;
}

beforeEach(() => document.body.replaceChildren());

describe('provider conversation digest', () => {
  it('keeps original untrusted bodies as text and refuses unsafe source and check links', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const panel = renderProviderReviewPanel(host(), {
      ...input([thread('a', { comments: [comment('1', `**Unsafe** ${attack}`)] })]),
      checks: [{ name: attack, status: 'completed', conclusion: 'success', sha: subject.headSha, detailsUrl: 'javascript:alert(1)' }],
    }, {
      comments: [{ ...comment('8', attack), url: 'https://user:secret@gitlab.com/private' }],
      events: [{ id: 'event-1', url: 'javascript:alert(3)', author: { id: 'u2', login: attack }, body: attack, createdAt: '2026-11-01T12:00:00Z' }],
    });
    expect(panel.element.querySelector('img,script')).toBeNull();
    expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__body')?.textContent).toBe(`**Unsafe** ${attack}`);
    expect([...panel.element.querySelectorAll('a')].every((value) => value.href.startsWith(`${reviewUrl}#note_`))).toBe(true);
    expect(panel.element.querySelector('[data-geld-source="note_8"] a')).toBeNull();
    expect(panel.element.textContent).toContain(attack);
  });

  it('preserves expanded conversations and closed groups across replies and state updates', () => {
    const original = thread('a');
    const panel = renderProviderReviewPanel(host(), input([original]));
    const item = panel.element.querySelector<HTMLDetailsElement>('details[data-geld-item]');
    const group = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-group="open"]');
    expect(item).not.toBeNull();
    if (item !== null) item.open = true;
    if (group !== null) group.open = false;
    panel.update(input([{ ...original, comments: [...original.comments, comment('3', 'The missing response still needs a guard.')] }]));
    expect(panel.element.querySelector<HTMLDetailsElement>('details[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-group="open"]')?.open).toBe(false);
    expect(panel.element.querySelectorAll('[data-geld-source]')).toHaveLength(2);
    panel.update(input([{ ...original, resolved: true }]));
    expect(panel.element.querySelector<HTMLDetailsElement>('details[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector('[data-geld-review-group="resolved"]')).not.toBeNull();
    panel.update({ ...input([{ ...original, url: original.url.replace('/42#', '/43#'), comments: original.comments.map((entry) => ({ ...entry, url: entry.url.replace('/42#', '/43#') })) }]), subject: { ...subject, id: '43' } });
    expect(panel.element.querySelector<HTMLDetailsElement>('details[data-geld-item]')?.open).toBe(false);
  });

  it('keeps outdated and resolved separate and reads no verdict into an unknown bot login', () => {
    const outdated = thread('a', { outdated: true, comments: [{ ...comment('1'), author: { id: 'unknown', login: 'cursor[bot]', automated: true } }] });
    const resolved = thread('b', { resolved: true, outdated: true });
    const panel = renderProviderReviewPanel(host(), input([outdated, resolved]));
    expect(panel.element.querySelector('[data-geld-review-group="outdated"] [data-state="outdated"]')).not.toBeNull();
    expect(panel.element.querySelector('[data-geld-review-group="resolved"] [data-state="resolved"]')).not.toBeNull();
    expect(panel.element.querySelector('[data-geld-review-group="open"]')).toBeNull();
    expect(panel.element.textContent).toContain('Automated account');
    expect(panel.element.textContent).not.toMatch(/Bugbot|Clean|Findings|running review/i);
    expect([...panel.element.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Copy digest']);
  });

  it('distinguishes a known empty review, an unavailable source and malformed data', () => {
    const panel = renderProviderReviewPanel(host(), input());
    expect(panel.element.dataset.state).toBe('ready');
    expect(panel.element.textContent).toContain('No review threads.');
    panel.update(input(), { complete: false, unavailable: [{ area: 'Discussions', reason: 'Sign in is required.' }] });
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.textContent).toContain('No review threads in the available data.');
    expect(panel.element.textContent).toContain('Discussions: Sign in is required.');
    panel.update(input([thread('a', { comments: [{ ...comment('1'), url: 'https://evil.example/comment' }] })]), {});
    expect(panel.element.dataset.state).toBe('unavailable');
    expect(panel.element.textContent).toContain('The review source could not be read.');
    expect(panel.element.textContent).not.toContain('No review threads.');
  });

  it('shows native reviewer standings and counts only CI on the current commit', () => {
    const panel = renderProviderReviewPanel(host(), {
      ...input(),
      reviewers: [
        { author: { id: '1', login: 'alice' }, state: 'approved' },
        { author: { id: '2', login: 'bob' }, state: 'changes_requested' },
        { author: { id: '3', login: 'carol' }, state: 'pending' },
      ],
      checks: [
        { name: 'Test', status: 'completed', conclusion: 'success', sha: subject.headSha, detailsUrl: 'https://ci.example/job/1' },
        { name: 'Build', status: 'in_progress', conclusion: null, sha: subject.headSha },
        { name: 'Old failure', status: 'completed', conclusion: 'failure', sha: 'b'.repeat(40) },
        { name: 'Unknown result', status: 'completed', conclusion: null, sha: subject.headSha },
      ],
    }, { approvalsRequired: 2, approvalsLeft: 1 });
    expect(panel.element.textContent).toContain('1/2 required approvals · 1 change request');
    expect(panel.element.textContent).toContain('Review requested');
    const checks = panel.element.querySelector('details[data-geld-review-key="checks"]');
    expect(checks?.querySelector('summary')?.textContent).toBe('CI checks · 1 passed · 1 running · 1 unknown');
    expect(checks?.textContent).toContain('Earlier commit · Failed');
    expect(checks?.querySelector('a')?.rel).toBe('noopener noreferrer');
  });

  it('counts independent pending requests beside standing approvals and change requests in UI and Markdown', async () => {
    let copied = '';
    const native: ProviderReviewInput = { ...input(), reviewers: [
      { author: { id: '1', login: 'alice' }, state: 'approved', reviewRequest: 'pending', anchor: 'note_1', url: `${reviewUrl}#note_1` },
      { author: { id: '2', login: 'bob' }, state: 'changes_requested', reviewRequest: 'pending' },
      { author: { id: '3', login: 'carol' }, state: 'pending', reviewRequest: 'unknown' },
    ] };
    const panel = renderProviderReviewPanel(host(), native, { copyText: (text) => { copied = text; } });
    const section = panel.element.querySelector('[data-geld-review-key="reviewers"]');
    expect(section?.querySelector('summary')?.textContent).toBe('Reviews · 1 approval · 1 change request · 2 pending reviews');
    expect(section?.querySelector('[data-state="approved"]')?.textContent).toBe('aliceApproved · Review requested');
    expect(section?.querySelector('[data-state="approved"]')?.lastElementChild?.classList.contains('geld-provider-review__muted')).toBe(true);
    expect(section?.querySelector('[data-state="changes_requested"]')?.textContent).toBe('bobChanges requested · Review requested');
    expect(section?.querySelector('[data-state="pending"]')?.textContent).toBe('carolReviewer · Request state unavailable');
    expect(section?.querySelector('a')?.href).toBe(`${reviewUrl}#note_1`);
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('- alice: Approved · Review requested'));
    expect(copied).toContain('- bob: Changes requested · Review requested');
    expect(copied).toContain('- carol: Reviewer · Request state unavailable');
    expect(copied).not.toMatch(/asked again|latest push/i);
    expect(native.reviewers?.[0]?.state).toBe('approved');
    panel.update(native, { approvalsRequired: 2, approvalsLeft: 0 });
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] > summary')?.textContent).toBe('Reviews · 2/2 required approvals · 1 change request · 2 pending reviews');
    panel.update({ ...native, reviewers: (native.reviewers ?? []).map((reviewer): ProviderReviewReviewer => ({ ...reviewer, reviewRequest: 'not-pending' })) }, {});
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] > summary')?.textContent).toBe('Reviews · 1 approval · 1 change request');
    expect(panel.element.querySelector('[data-state="approved"]')?.textContent).toBe('aliceApproved');
  });

  it('retains state-only legacy presentation while explicit unknown never invents a request', () => {
    const native: ProviderReviewInput = { ...input(), reviewers: [
      { author: { id: '1', login: 'legacy' }, state: 'pending' },
      { author: { id: '2', login: 'assigned' }, state: 'pending', reviewRequest: 'unknown' },
      { author: { id: '3', login: 'approver' }, state: 'approved', reviewRequest: 'unknown' },
    ] };
    const panel = renderProviderReviewPanel(host(), native, {});
    const section = panel.element.querySelector('[data-geld-review-key="reviewers"]');
    expect(section?.querySelector('summary')?.textContent).toBe('Reviews · 1 approval · 1 pending review');
    expect(section?.querySelectorAll('li')[0]?.textContent).toBe('legacyReview requested');
    expect(section?.querySelectorAll('li')[1]?.textContent).toBe('assignedReviewer · Request state unavailable');
    expect(section?.querySelectorAll('li')[2]?.textContent).toBe('approverApproved · Request state unavailable');
  });

  it('copies native source links and leaves navigation to the provider callback', async () => {
    let copied = '';
    const opened = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { onOpenSource: opened, copyText: (text) => { copied = text; } });
    panel.element.querySelector<HTMLAnchorElement>('[data-geld-source="note_1"] a')?.click();
    expect(opened).toHaveBeenCalledWith(`${reviewUrl}#note_1`, 'note_1', expect.any(MouseEvent));
    panel.element.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => expect(copied).toContain(`${reviewUrl}#note_1`));
    expect(copied).toContain('Open: Check the response before reading it.');
    expect(copied).not.toContain('github.com');
    panel.destroy();
    expect(document.querySelector('.geld-provider-review')).toBeNull();
    panel.update(input());
    expect(document.querySelector('.geld-provider-review')).toBeNull();
  });

  it('renders bound native bot results without granting a clean verdict to partial data', () => {
    const author = { id: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe', automated: true };
    const finding = { ...comment('1', '**Fix malformed table rows in the properties table.**'), author };
    const native: ProviderReviewInput = { ...input([thread('a', { resolved: true, comments: [finding] })]), bots: [{ id: 'coderabbit', authorId: author.id, login: author.login }], complete: true };
    const summary = { ...comment('2', '**Actionable comments posted: 1**'), author, createdAt: '2026-11-01T11:59:00Z' };
    const panel = renderProviderReviewPanel(host(), native, { comments: [summary] });
    const row = panel.element.querySelector('[data-geld-review-bot="coderabbit"]');
    expect(row?.textContent).toContain('CodeRabbit');
    expect(row?.textContent).toContain('Findings resolved');
    expect(row?.textContent).toContain(author.login);
    expect(row?.querySelector('a')?.href).toBe(finding.url);
    panel.update({ ...native, complete: false }, { comments: [summary] });
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('count unavailable');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).not.toContain('No findings');
  });

  it('offers explicit identity only for unbound automated accounts and supported services', async () => {
    const automated = { ...comment('1', '<!-- CodeRabbit marker is not an identity -->'), author: { id: '12345', login: 'unidentified-project-account', automated: true } };
    const save = vi.fn(async (_comment: ProviderReviewComment, _botId: string) => undefined);
    const options = { identifyReviewer: { repository: { provider: subject.provider, origin: subject.origin, path: subject.repository }, choices: [{ id: 'coderabbit', label: 'CodeRabbit' }, { id: 'copilot', label: 'Copilot' }], save } };
    const panel = renderProviderReviewPanel(host(), input([thread('a', { comments: [automated, { ...comment('2'), author: { id: '67890', login: 'human-reviewer', automated: false } }] })]), options);
    expect(save).not.toHaveBeenCalled();
    const identities = panel.element.querySelectorAll('.geld-provider-reviewer-identity');
    expect(identities).toHaveLength(1);
    expect(identities[0]?.textContent).not.toContain('Copilot');
    expect(identities[0]?.textContent).toContain('12345');
    [...panel.element.querySelectorAll<HTMLButtonElement>('.geld-provider-reviewer-identity button')].find((button) => button.textContent === 'CodeRabbit')?.click();
    expect(save).not.toHaveBeenCalled();
    expect(panel.element.querySelector('.geld-provider-reviewer-identity__confirmation')?.textContent).toContain('Trust unidentified-project-account as CodeRabbit for this repository?');
    [...panel.element.querySelectorAll<HTMLButtonElement>('.geld-provider-reviewer-identity button')].find((button) => button.textContent === 'Trust')?.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(automated, 'coderabbit'));
    panel.update({ ...input([thread('a', { comments: [automated] })]), bots: [{ id: 'coderabbit', authorId: '12345' }] }, options);
    expect(panel.element.querySelector('.geld-provider-reviewer-identity')).toBeNull();
  });

  it('runs and cancels AI only from controls and keeps original human text alongside transformed findings', () => {
    const original = input([thread('a')]);
    const base = buildProviderReviewItems(original);
    const run = vi.fn();
    const cancel = vi.fn();
    const state: ProviderAiState = { kind: 'ready', key: providerReviewKey(original.subject), pending: new Set(), stale: false, summary: { tldr: '<script>plain text</script>', updatedAt: '2026-11-01T13:00:00Z', forItems: base.map((item) => item.id) } };
    const options = { ai: { enabled: true, state, run, cancel }, transformItems: (items: typeof base) => items.map((item) => ({ ...item, title: 'AI consolidated title', context: 'Additional context', rewritten: true })) };
    const panel = renderProviderReviewPanel(host(), original, options);
    expect(run).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-item] > summary')?.textContent).toContain('AI consolidated title');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
    expect(panel.element.querySelector('[data-geld-ai-summary]')?.textContent).toContain('<script>plain text</script>');
    expect(panel.element.querySelector('script')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    expect(run).toHaveBeenCalledTimes(1);
    panel.update(original, { ...options, ai: { ...options.ai, state: { ...state, kind: 'running', pending: new Set(['tldr']) } } });
    expect(panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.disabled).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('[data-geld-ai-cancel]')?.click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps edited human comments in their creation round and seats new comments after the next native push', () => {
    const original = input([thread('a')]);
    const edited = { ...comment('2', 'Current edited review text.'), updatedAt: '2026-11-01T14:00:00Z' };
    const latest = { ...comment('3', 'New human comment after the second push.'), createdAt: '2026-11-01T13:30:00Z' };
    const events: readonly ProviderReviewPanelEvent[] = [{ id: 'push-1', url: reviewUrl, author: comment('1').author, body: 'Native push event one', createdAt: '2026-11-01T11:00:00Z', kind: 'push' }, { id: 'push-2', url: reviewUrl, author: comment('1').author, body: 'Native push event two', createdAt: '2026-11-01T13:00:00Z', kind: 'push' }];
    const options = { reviewGrouping: 'batch', comments: [edited, latest], events } satisfies Parameters<typeof renderProviderReviewPanel>[2];
    const panel = renderProviderReviewPanel(host(), original, options);
    const rounds = panel.element.querySelectorAll<HTMLDetailsElement>('[data-geld-review-round]');
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.textContent).toContain(comment('1').body);
    expect(rounds[0]?.querySelector('[data-geld-source="note_2"]')?.textContent).toContain(edited.body);
    expect(rounds[0]?.textContent).toContain('Edited');
    expect(rounds[0]?.querySelector<HTMLTimeElement>('[data-geld-source="note_2"] time:last-of-type')?.dateTime).toBe('2026-11-01T14:00:00.000Z');
    expect(rounds[1]?.textContent).toContain('Latest recorded push');
    expect(rounds[1]?.textContent).toContain(latest.body);
    expect(rounds[1]?.querySelector('[data-geld-source="note_2"]')).toBeNull();
    expect(rounds[0]?.querySelector<HTMLAnchorElement>('[data-geld-source="note_2"] a')?.href).toBe(edited.url);
    const item = rounds[0]?.querySelector<HTMLDetailsElement>('[data-geld-item]');
    if (item !== null && item !== undefined) item.open = true;
    panel.update(original, { ...options, reviewGrouping: 'type' });
    expect(panel.element.querySelector('[data-geld-review-round]')).toBeNull();
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-item]')?.open).toBe(true);
    panel.update(original, { ...options, comments: [] });
    expect(panel.element.querySelector('[data-geld-review-round="push-2"]')?.textContent).toContain('No conversation recorded after this push.');
  });

  it('keeps an edited human thread and later replies with its original push while a new thread joins the later push', () => {
    const first = comment('1', 'Original human thread before the next push.');
    const later = { ...comment('2', 'New thread after the next push.'), createdAt: '2026-11-01T13:30:00Z' };
    const original = input([thread('a', { comments: [first] }), thread('b', { comments: [later] })]);
    const events: readonly ProviderReviewPanelEvent[] = [
      { id: 'push-a', url: reviewUrl, author: first.author, body: 'Native first push', createdAt: '2026-11-01T11:00:00Z', kind: 'push', headSha: 'b'.repeat(40) },
      { id: 'push-b', url: reviewUrl, author: first.author, body: 'Native latest push', createdAt: '2026-11-01T13:00:00Z', kind: 'push', headSha: subject.headSha },
    ];
    const panel = renderProviderReviewPanel(host(), original, { reviewGrouping: 'batch', events });
    const originalLaterId = panel.element.querySelector<HTMLElement>('[data-geld-review-round="push-b"] [data-geld-item]')?.dataset.geldItem;
    const edited = { ...first, body: 'Current edited human thread text.', updatedAt: '2026-11-01T14:00:00Z' };
    const reply = { ...comment('3', 'Actual reply after the later push.'), createdAt: '2026-11-01T14:30:00Z' };
    const refreshed = input([thread('a', { comments: [edited, reply] }), thread('b', { comments: [later] })]);
    panel.update(refreshed, { reviewGrouping: 'batch', events });
    const earlierRound = panel.element.querySelector('[data-geld-review-round="push-a"]');
    const laterRound = panel.element.querySelector('[data-geld-review-round="push-b"]');
    expect(earlierRound?.querySelector('[data-geld-source="note_1"]')?.textContent).toContain(edited.body);
    expect(earlierRound?.querySelector('[data-geld-source="note_3"]')?.textContent).toContain(reply.body);
    expect(earlierRound?.textContent).toContain('Edited');
    expect(laterRound?.querySelector('[data-geld-source="note_2"]')?.textContent).toContain(later.body);
    expect(laterRound?.querySelector('[data-geld-source="note_1"], [data-geld-source="note_3"]')).toBeNull();
    expect(laterRound?.textContent).toContain('Latest recorded push');
    expect(laterRound?.querySelector<HTMLElement>('[data-geld-item]')?.dataset.geldItem).toBe(originalLaterId);
    expect([...panel.element.querySelectorAll<HTMLElement>('[data-geld-source]')].map((source) => source.dataset.geldSource)).toEqual(['note_1', 'note_3', 'note_2']);
    expect(refreshed.subject.headSha).toBe(subject.headSha);
    expect(earlierRound?.textContent).not.toContain(first.body);
  });

  it('keeps an automated edited report on its latest edit clock without moving its original finding thread', () => {
    const author = { id: '38968537', login: 'native-review-service', automated: true };
    const finding = { ...comment('1', 'Original native automated finding.'), author, updatedAt: '2026-11-01T14:00:00Z' };
    const report = { ...comment('2', 'Current edited review report.'), author, updatedAt: '2026-11-01T14:00:00Z' };
    const panel = renderProviderReviewPanel(host(), input([thread('a', { comments: [finding] })]), { reviewGrouping: 'batch', comments: [report], events: [
      { id: 'push-a', url: reviewUrl, author, body: 'Native first push', createdAt: '2026-11-01T11:00:00Z', kind: 'push' },
      { id: 'push-b', url: reviewUrl, author, body: 'Native latest push', createdAt: '2026-11-01T13:00:00Z', kind: 'push' },
    ] });
    const earlierRound = panel.element.querySelector('[data-geld-review-round="push-a"]');
    const laterRound = panel.element.querySelector('[data-geld-review-round="push-b"]');
    expect(earlierRound?.querySelector('[data-geld-source="note_1"]')?.textContent).toContain(finding.body);
    expect(earlierRound?.querySelector('[data-geld-source="note_2"]')).toBeNull();
    expect(laterRound?.querySelector('[data-geld-source="note_2"]')?.textContent).toContain(report.body);
    expect(laterRound?.querySelector<HTMLTimeElement>('[data-geld-source="note_2"] time:last-of-type')?.dateTime).toBe('2026-11-01T14:00:00.000Z');
    expect(laterRound?.textContent).toContain('Automated account');
    expect(laterRound?.textContent).toContain('Edited');
    expect(panel.element.querySelectorAll('[data-geld-source="note_2"]')).toHaveLength(1);
  });

  it('does not invent push rounds from comment prose or events with unknown kinds', () => {
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { reviewGrouping: 'batch', comments: [comment('2', 'I pushed a new commit abc1234.')], events: [{ id: 'unknown', url: reviewUrl, author: comment('1').author, body: 'Added 1 commit', createdAt: '2026-11-01T11:00:00Z', kind: 'activity' }] });
    expect(panel.element.querySelector('[data-geld-review-round]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-history]')?.textContent).toContain('push boundaries unavailable');
    expect(panel.element.textContent).toContain('I pushed a new commit');
  });

  it('reads reports only from actual current check service hosts, without GitHub check-name inference', () => {
    const panel = renderProviderReviewPanel(host(), { ...input(), checks: [
      { name: 'codecov/project', sha: subject.headSha, status: 'completed', conclusion: 'success', description: '80.12% (+0.03%) compared to abc1234', detailsUrl: 'https://app.codecov.io/gl/group/project/pull/42' },
      { name: 'codecov/patch', sha: subject.headSha, status: 'completed', conclusion: 'success', description: '90% covered', detailsUrl: 'https://codecov.io.evil.example/attack' },
      { name: 'CodeQL', sha: subject.headSha, status: 'completed', conclusion: 'success', description: 'No new alerts in code changed by this pull request', detailsUrl: 'https://gitlab.com/group/project/runs/123' },
      { name: 'codecov/old', sha: 'b'.repeat(40), status: 'completed', conclusion: 'failure', detailsUrl: 'https://codecov.io/gl/group/project' },
    ] });
    expect(panel.element.querySelectorAll('[data-geld-report]')).toHaveLength(1);
    expect(panel.element.querySelector('[data-geld-report="codecov"]')?.textContent).toContain('80.12% (+0.03%)');
    expect(panel.element.querySelector('[data-geld-report="codecov"] a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('attributes preview links to their actual automated source, archives earlier links, and never grants a review vote', () => {
    const author = { id: '12345', login: 'native-deploy-account', automated: true };
    const earlier = { ...comment('2', 'Preview ready: [Preview](https://deploy.example/first)'), author, createdAt: '2026-11-01T10:00:00Z' };
    const latest = { ...comment('3', 'Preview failed: [Preview](https://deploy.example/second)'), author, createdAt: '2026-11-01T11:00:00Z' };
    const human = { ...comment('4', 'Preview ready: [Preview](https://unverified.example/)'), author: { id: '456', login: 'a-person', automated: false } };
    const unsafe = { ...comment('5', 'Preview ready: [Preview](javascript:alert(1))'), author };
    const panel = renderProviderReviewPanel(host(), input(), { comments: [latest, earlier, human, unsafe] });
    const section = panel.element.querySelector('[data-geld-review-key="previews"]');
    expect(section?.querySelector('summary')?.textContent).toBe('Preview links · 1');
    expect(section?.querySelector('[data-geld-preview="note_3"]')?.textContent).toContain('native-deploy-account · Reported status: failed');
    expect(section?.querySelector('[data-geld-preview="note_3"] > a')?.getAttribute('href')).toBe('https://deploy.example/second');
    expect(section?.querySelector('[data-geld-review-key="previews:earlier"] [data-geld-preview]')?.getAttribute('data-geld-preview')).toBe('note_2');
    expect(section?.textContent).not.toContain('a-person');
    expect(section?.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('marks an item reviewed locally without resolving its native thread or erasing bot findings', () => {
    const author = { id: '12345', login: 'native-review-account', automated: true };
    const source: ProviderReviewInput = { ...input([thread('a', { comments: [{ ...comment('1', '**Fix the credentials cache.**'), author }] })]), bots: [{ id: 'coderabbit', authorId: author.id }], complete: true };
    const [native] = buildProviderReviewItems(source);
    if (native === undefined) throw new Error('Missing native item.');
    const set = vi.fn();
    const localReviewed = { ids: new Set([native.id]), pending: new Set<string>(), set };
    const transformItems = (items: readonly typeof native[]) => items.map((item) => ({ ...item, title: 'AI consolidated cache title', context: 'The native words remain below.', rewritten: true }));
    const panel = renderProviderReviewPanel(host(), source, { localReviewed, transformItems });
    expect(set).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-review-group="done"] [data-geld-item] > summary')?.textContent).toContain('AI consolidated cache title');
    expect(panel.element.querySelector('[data-geld-local-review-notice]')?.textContent).toBe('Reviewed on this device. Native status: Open.');
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('1 open finding');
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe('**Fix the credentials cache.**');
    expect(source.threads[0]?.resolved).toBe(false);
    panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ id: native.id, title: 'AI consolidated cache title' }), false);
    panel.update(source, { localReviewed: { ...localReviewed, pending: new Set([native.id]) }, transformItems });
    panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    expect(set).toHaveBeenCalledTimes(1);
    expect(panel.element.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('retains native resolved state and includes the distinct local mark in copied digest history', async () => {
    const source = input([thread('a', { resolved: true })]);
    const [native] = buildProviderReviewItems(source);
    if (native === undefined) throw new Error('Missing native item.');
    let copied = '';
    const panel = renderProviderReviewPanel(host(), source, { localReviewed: { ids: new Set([native.id]), pending: new Set(), set: () => undefined }, copyText: (text) => { copied = text; }, reviewGrouping: 'batch', events: [{ id: 'native-push', url: reviewUrl, author: comment('1').author, body: 'Actual native push', createdAt: '2026-11-01T11:00:00Z', kind: 'push' }] });
    expect(panel.element.querySelector('[data-geld-item]')?.getAttribute('data-state')).toBe('resolved');
    expect(panel.element.querySelector('[data-geld-review-round="native-push"] [data-geld-local-review-notice]')?.textContent).toContain('Native status: Resolved');
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain('Reviewed on this device. Native status: Resolved.'));
    expect(copied).toContain(`${reviewUrl}#note_1`);
  });

  it('keeps keyboard focus with a local review action while its item moves between groups', () => {
    const source = input([thread('a')]);
    const [item] = buildProviderReviewItems(source);
    if (item === undefined) throw new Error('Missing native item.');
    const set = vi.fn();
    const panel = renderProviderReviewPanel(host(), source, { localReviewed: { ids: new Set(), pending: new Set(), set } });
    const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]');
    const details = panel.element.querySelector<HTMLDetailsElement>('[data-geld-item]');
    if (details !== null) details.open = true;
    button?.focus();
    panel.update(source, { localReviewed: { ids: new Set(), pending: new Set([item.id]), set } });
    expect(document.activeElement?.getAttribute('data-geld-local-review-focus')).toBe(item.id);
    panel.update(source, { localReviewed: { ids: new Set([item.id]), pending: new Set(), set } });
    expect(document.activeElement?.getAttribute('data-geld-local-reviewed')).toBe(item.id);
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-group="done"]')?.open).toBe(true);
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-item]')?.open).toBe(true);
  });

  it('retains a verified native avatar, name, profile and role classes without changing source navigation or controls', async () => {
    const source = comment('1');
    const presentation: ProviderReviewAuthorPresentation = {
      authorId: source.author.id, displayName: 'Jorge Tomás', username: '@jotolo_gl', profileUrl: `${subject.origin}/jotolo_gl`,
      avatar: { src: `${subject.origin}/uploads/-/system/user/avatar/33096491/avatar.png`, width: 32, height: 32, borderRadius: '50%', className: 'gl-avatar gl-avatar-circle gl-avatar-s32' },
      badges: [{ label: 'Author', title: 'This user is the author of this merge request.', className: 'gl-badge badge badge-pill badge-neutral' }, { label: 'Developer', title: 'This user has the developer role in the GitLab project.', className: 'gl-badge badge badge-pill badge-neutral' }],
    };
    const opened = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
    const activate = vi.fn(async () => true);
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => presentation, onOpenSource: opened, actionsForSource: () => [{ kind: 'reply', label: 'Native reply', available: true, activate }] });
    const avatar = panel.element.querySelector<HTMLImageElement>('[data-geld-author-avatar]');
    expect(avatar?.src).toBe(presentation.avatar?.src);
    expect(avatar?.style.width).toBe('32px');
    expect(avatar?.style.height).toBe('32px');
    expect(avatar?.style.borderRadius).toBe('50%');
    expect(avatar?.classList.contains('gl-avatar-circle')).toBe(true);
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    const profile = panel.element.querySelector<HTMLAnchorElement>('[data-geld-author-profile]');
    expect(profile?.href).toBe(presentation.profileUrl);
    expect(profile?.textContent).toBe('Jorge Tomás');
    expect(panel.element.querySelector('.geld-provider-review__byline')?.textContent).toContain('@jotolo_gl');
    const roles = [...panel.element.querySelectorAll<HTMLElement>('[data-geld-author-badge]')];
    expect(roles.map((role) => role.textContent)).toEqual(['Author', 'Developer']);
    expect(roles.every((role) => role.classList.contains('badge-neutral') && role.style.color === '' && role.style.backgroundColor === '')).toBe(true);
    expect(panel.element.querySelector('time')?.dateTime).toBe(source.createdAt.replace('Z', '.000Z'));
    [...panel.element.querySelectorAll<HTMLAnchorElement>('[data-geld-source="note_1"] a')].find((anchor) => anchor.textContent === 'View original')?.click();
    expect(opened).toHaveBeenCalledWith(source.url, source.anchor, expect.any(MouseEvent));
    [...panel.element.querySelectorAll<HTMLButtonElement>('[data-geld-source="note_1"] button')].find((button) => button.textContent === 'Native reply')?.click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(source.body);
  });

  it('falls back to the normalized author when native identity is mismatched, empty or unavailable', () => {
    const forged: ProviderReviewAuthorPresentation = { authorId: 'different-account', displayName: 'Maintainer person', badges: [{ label: 'Owner' }], avatar: { src: 'https://avatars.example/person.png', width: 32, height: 32 } };
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => forged });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    expect(panel.element.querySelector('[data-geld-author-avatar],[data-geld-author-badge]')).toBeNull();
    panel.update(input([thread('a')]), { authorPresentation: () => ({ ...forged, authorId: 'user-1', displayName: ' ' }) });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    panel.update(input([thread('a')]), { authorPresentation: () => { throw new Error('Native header was replaced.'); } });
    expect(panel.element.dataset.state).toBe('ready');
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
    expect(panel.element.querySelector('[data-geld-source="note_1"] a')?.getAttribute('href')).toBe(comment('1').url);
  });

  it('rejects unsafe avatar/profile URLs and invalid dimensions while keeping verified names as text', () => {
    const sources: readonly ProviderReviewAuthorPresentation[] = [
      { authorId: 'user-1', displayName: 'Native name', profileUrl: 'https://evil.example/alice', avatar: { src: 'javascript:alert(1)', width: 32, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', profileUrl: 'https://alice:secret@gitlab.com/alice', avatar: { src: 'data:image/svg+xml,<svg onload=alert(1)>', width: 32, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'https://avatars.example/alice.png', width: -1, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'https://avatars.example/alice.png', width: Infinity, height: 32 } },
      { authorId: 'user-1', displayName: 'Native name', avatar: { src: 'http://avatars.example/alice.png', width: 32, height: 32 } },
    ];
    for (const presentation of sources) {
      const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => presentation });
      expect(panel.element.querySelector('[data-geld-author-profile],[data-geld-author-avatar]')).toBeNull();
      expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('Native name');
      expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
    }
  });

  it('inserts names and roles as text without copying native handlers, ids or arbitrary HTML', () => {
    const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { authorPresentation: () => ({ authorId: 'user-1', displayName: markup, avatar: { src: 'https://avatars.example/alice.png', width: 32, height: 32, className: 'gl-avatar geld-provider-hidden onclick="attack"' }, badges: [{ label: markup, title: markup, className: 'gl-badge badge-neutral id="forged" onclick="attack"' }] }) });
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe(markup);
    const badge = panel.element.querySelector('[data-geld-author-badge]');
    expect(badge?.textContent).toBe(markup);
    expect(badge?.getAttribute('title')).toBe(markup);
    expect(panel.element.querySelector('script,[onerror],[onclick],#forged')).toBeNull();
    expect(panel.element.querySelectorAll('img')).toHaveLength(1);
    expect(panel.element.querySelector('[data-geld-author-avatar]')?.classList.contains('geld-provider-hidden')).toBe(false);
    expect(badge?.classList.contains('badge-neutral')).toBe(true);
  });

  it('refreshes native presentation independently of source text and keeps theme styling in native classes', () => {
    let presentation: ProviderReviewAuthorPresentation = { authorId: 'user-1', displayName: 'First native name', badges: [{ label: 'Developer', className: 'gl-badge badge badge-neutral' }] };
    const source = input([thread('a')]);
    const options = { authorPresentation: () => presentation };
    const panel = renderProviderReviewPanel(host(), source, options);
    const details = panel.element.querySelector<HTMLDetailsElement>('[data-geld-item]');
    if (details !== null) details.open = true;
    presentation = { ...presentation, displayName: 'Updated native name', badges: [{ label: 'Maintainer', title: 'Verified native header changed.', className: 'gl-badge badge badge-neutral' }] };
    panel.update(source, options);
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('Updated native name');
    expect(panel.element.querySelector('[data-geld-author-badge]')?.textContent).toBe('Maintainer');
    expect(panel.element.querySelector<HTMLElement>('[data-geld-author-badge]')?.style.cssText).toBe('');
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-item]')?.open).toBe(true);
    expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment('1').body);
  });

  it('does not attach native presentation to an ordinary comment with an invalid original source URL', () => {
    const presentation = vi.fn(() => ({ authorId: 'user-1', displayName: 'Unverified role owner', badges: [{ label: 'Owner' }] }));
    const panel = renderProviderReviewPanel(host(), input(), { comments: [{ ...comment('1'), url: 'https://evil.example/not-this-review' }], authorPresentation: presentation });
    expect(presentation).not.toHaveBeenCalled();
    expect(panel.element.querySelector('[data-geld-author-badge]')).toBeNull();
    expect(panel.element.querySelector('.geld-provider-review__byline strong')?.textContent).toBe('alice');
  });

  it('does not reuse another account’s metadata when ordinary data repeats a native source anchor', () => {
    const original = comment('1');
    const duplicate = { ...original, author: { id: 'different-user', login: 'another-account' } };
    const panel = renderProviderReviewPanel(host(), input([thread('a')]), { comments: [duplicate], authorPresentation: (source) => ({ authorId: source.author.id, displayName: source.author.id === original.author.id ? 'Actual native author' : 'Another native author', badges: [{ label: source.author.id === original.author.id ? 'Developer' : 'Maintainer' }] }) });
    expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__byline strong')?.textContent).toBe('Actual native author');
    expect(panel.element.querySelector('[data-geld-source="note_1"] [data-geld-author-badge]')?.textContent).toBe('Developer');
  });

  it('shows individual native merge rules without inferring approval counts, review votes or source completeness', () => {
    const panel = renderProviderReviewPanel(host(), { subject, threads: [], reviewers: [{ author: { id: '1', login: 'alice' }, state: 'approved' }] }, {
      complete: false, approvalsRequired: null, approvalsLeft: null,
      unavailable: [{ area: 'CI checks', reason: 'Authentication is required.' }, { area: 'approval requirements', reason: 'The API did not supply approval requirements.' }],
      requirements: [
        { id: 'classicMergeCheckItem-minimum_approvals', label: '1+ approval', state: 'passed' },
        { id: 'classicMergeCheckItem-minimum_default_reviewer_approvals', label: '1+ approval from default reviewers', state: 'passed' },
      ],
    });
    const section = panel.element.querySelector('[data-geld-review-key="requirements"]');
    expect(section?.querySelector('summary')?.textContent).toBe('Merge requirements · 2 shown');
    expect(section?.querySelectorAll('[data-geld-native-requirement]')).toHaveLength(2);
    expect(section?.textContent).toContain('1+ approval from default reviewers');
    expect(panel.element.querySelector('[data-geld-review-key="reviewers"] > summary')?.textContent).toBe('Reviews · 1 approval');
    expect(panel.element.textContent).not.toContain('/2 required approvals');
    expect(panel.element.querySelector('[data-geld-review-key="checks"]')?.textContent).toContain('CI checks · Unavailable');
    expect(panel.element.textContent).toContain('Authentication is required.');
    expect(panel.element.textContent).toContain('The API did not supply approval requirements.');
    expect(panel.element.dataset.state).toBe('partial');
    expect(panel.element.querySelector('[data-geld-review-bot]')).toBeNull();
  });

  it('updates observed merge rule states, preserves disclosure, and copies source labels as text', async () => {
    let copied = '';
    const label = '<img src=x onerror=alert(1)> Native rule';
    const options = { requirements: [{ id: 'native-rule', label, state: 'passed' }], copyText: (text: string) => { copied = text; } } satisfies Parameters<typeof renderProviderReviewPanel>[2];
    const panel = renderProviderReviewPanel(host(), input(), options);
    const section = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="requirements"]');
    if (section !== null) section.open = true;
    panel.update(input(), { ...options, requirements: [{ id: 'native-rule', label, state: 'unknown' }] });
    expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="requirements"]')?.open).toBe(true);
    expect(panel.element.querySelector('[data-geld-native-requirement="native-rule"]')?.textContent).toContain(`${label}Unknown`);
    expect(panel.element.querySelector('img,[onerror]')).toBeNull();
    panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
    await vi.waitFor(() => expect(copied).toContain(`Merge requirement: ${label}: Unknown`));
    panel.update(input(), { requirements: null });
    expect(panel.element.querySelector('[data-geld-review-key="requirements"]')).toBeNull();
  });
});
