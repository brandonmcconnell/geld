import { describe, expect, it } from 'vitest';
import { findingSeverity, botByCheckName, botsTriggeredBy, isMacroscopeAgentComment, isReviewShaped, isStatusLineComment, parseBotBody, refusalReason, UNKNOWN_SHA, verdictsFrom } from './bots';
import type { BotComment, RawCheckRun } from './bots';
import { clusterComments, firstSentence, guessSeverity } from './cluster';
import { parseGeldPrMeta } from './model';
import { readCheckReport } from './reporters';
import { renderSummary } from './summary-render';

// Shapes as Macroscope posted them on public pull requests (Nov 2026): raw Markdown, which the Action reads, and the
// page's text (`blockText`: headings as bare lines, bold and code kept as marks), which the extension reads.
const HEAD = 'b830bd0b830bd0b830bd0b830bd0b830bd0b830b';
const BOT = 'macroscopeapp[bot]';

const approvability = (verdict: string, rest = ''): string =>
  `<!-- MURMUR_IGNORE -->\n#### Approvability\n\n**Verdict:** ${verdict}\n\nMacroscope's review found this PR approvable — Adds structured output.${rest}\n\n<sup>You can add or adjust custom eligibility rules. [Learn more](https://docs.macroscope.com/approvability).</sup>\n<!-- macroscope-meta: {"kind":"approvability"} -->`;
const approvabilityOnPage = (verdict: string): string => `Approvability\n\n**Verdict:** ${verdict}\n\nMacroscope's review found this PR requires human approval — The unresolved finding needs resolution.\n\nYou can add or adjust custom eligibility rules. Learn more.`;
const finding = (level: string, path: string, words: string): string =>
  `<!-- MURMUR_IGNORE -->\n${level} \`${path}\`\n\n${words}\n\n<details>\n<summary>🚀 Reply "<strong>fix it for me</strong>" or copy this <strong>AI Prompt</strong> for your agent:</summary>\n\n\`\`\`text\nIn file @${path}:\n\n${words}\n\`\`\`\n</details>\n<!-- macroscope-meta: {"kind":"code_review"} -->`;
const AGENT_COMMENT =
  'The Download action can now appear on movie and series detail pages. Please add before/after screenshots.\n\nSuggested fix: Attach the captures under `## Evidence`.\n\n<sub>Automated check: Macroscope check run agent (gpt-6-luna). Evidence was not reviewed for correctness.</sub>\n\n<sup>Posted via Macroscope — <a href="https://github.com/o/r/runs/1">Visible change evidence</a></sup>\n<!-- macroscope-meta: {"kind":"check_run"} -->';

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 8, 12, minute)).toISOString();
const thread = (anchor: string, minute: number, resolved: boolean, level = '🟠 **High**'): BotComment => ({
  author: BOT,
  body: finding(level, 'gdpval/grader.py:87', 'Scores are averaged before the failed tasks are dropped, so a failing run reads as passing. Drop them first.'),
  anchor,
  createdAt: at(minute),
  resolved,
});
const check = (name: string, conclusion: string | null, description?: string, extra: Partial<RawCheckRun> = {}): RawCheckRun => ({
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  sha: HEAD,
  ...(description === undefined ? {} : { description }),
  ...extra,
});
const macroscope = (checks: readonly RawCheckRun[], comments: readonly BotComment[], now = Date.parse(at(59))) =>
  verdictsFrom(checks, comments, HEAD, [], now, { complete: true }).find((verdict) => verdict.id === 'macroscope');

describe('Macroscope', () => {
  it('knows its review by the Correctness Check alone, and a mention as a request', () => {
    expect(botByCheckName('Macroscope - Correctness Check')?.id).toBe('macroscope');
    for (const name of ['Macroscope - Approvability Check', 'Macroscope - UI Consistency', 'Macroscope - Visible change evidence']) expect(botByCheckName(name), name).toBeNull();
    for (const body of ['@macroscope-app review', '@macroscope-app', '@macroscope-app review this PR']) expect(botsTriggeredBy(body).map((bot) => bot.id), body).toEqual(['macroscope']);
  });

  it('counts every open thread, with the worst badge, though its Approvability verdict follows them', () => {
    const comments = [thread('discussion_r1', 1, false), thread('discussion_r2', 1, false, '🟡 **Medium**'), thread('discussion_r3', 1, false), { author: BOT, body: approvability('Needs Human Approval'), anchor: 'issuecomment-9', createdAt: at(2) }];
    const checks = [check('Macroscope - Correctness Check', 'neutral', '3 issues identified (10 code objects reviewed).'), check('Macroscope - Approvability Check', 'neutral', 'Needs Human Approval')];
    expect(macroscope(checks, comments)).toMatchObject({ verdict: 'findings', count: 3, severity: 'high', checkName: 'Macroscope - Correctness Check', reviewedSha: HEAD, sourceId: 'discussion_r1' });
    // ...and the same when Approvability approves over open findings (its blocking severity set off).
    expect(macroscope(checks, [...comments.slice(0, 3), { author: BOT, body: approvability('Approved at `b830bd0`'), anchor: 'issuecomment-9', createdAt: at(2) }])).toMatchObject({ verdict: 'findings', count: 3 });
    // ...and in the page's words.
    expect(macroscope(checks, [...comments.slice(0, 3), { author: BOT, body: approvabilityOnPage('Needs Human Approval'), anchor: 'issuecomment-9', createdAt: at(2) }])).toMatchObject({ verdict: 'findings', count: 3 });
  });

  it('keeps open threads through a later run, a request and a check that found nothing new', () => {
    const comments: BotComment[] = [
      thread('discussion_r1', 1, false),
      thread('discussion_r2', 1, true, '🟡 **Medium**'),
      { author: BOT, body: approvability('Needs Human Approval'), anchor: 'issuecomment-9', createdAt: at(2), editedAt: at(30) },
      { author: 'octocat', body: '@macroscope-app review', anchor: 'issuecomment-10', createdAt: at(20) },
      { author: BOT, body: 'Review started; results will appear in the PR checks.\n<!-- macroscope-meta: {"kind":"pr_assistant"} -->', anchor: 'issuecomment-11', createdAt: at(20) },
    ];
    // Asked again: running while the new run is under way.
    expect(macroscope([check('Macroscope - Correctness Check', null, undefined, { startedAt: at(21) })], comments)?.verdict).toBe('running');
    // It finished with nothing new in the files it read: the open thread still stands, with its own badge.
    const done = check('Macroscope - Correctness Check', 'success', 'No issues identified (1 code object reviewed).', { startedAt: at(21), completedAt: at(24) });
    expect(macroscope([done], comments)).toMatchObject({ verdict: 'findings', count: 1, severity: 'high' });
    // Every thread resolved by Macroscope: resolved, current.
    const settled = comments.map((comment) => (comment.anchor === 'discussion_r1' ? { ...comment, resolved: true } : comment));
    expect(macroscope([done], settled)).toMatchObject({ reviewedSha: HEAD });
    expect(['clean', 'findings']).toContain(macroscope([done], settled)?.verdict);
    expect(macroscope([done], settled)?.count ?? 0).toBe(0);
  });

  it('is not failed or behind when a Check Run Agent or the gate skipped', () => {
    const checks = [
      check('Macroscope - Approvability Check', 'skipped', "'Approvability' is disabled"),
      check('Macroscope - Correctness Check', 'success', 'No issues identified (1 code object reviewed).'),
      check('Macroscope - Effect Service Conventions', 'skipped', 'Prerequisite check(s) not found'),
      check('Macroscope - UI Consistency', 'skipped', 'Prerequisite check(s) not found'),
    ];
    expect(macroscope(checks, [thread('discussion_r1', 1, true)])).toMatchObject({ reviewedSha: HEAD });
    expect(macroscope(checks, [thread('discussion_r1', 1, true)])?.verdict).not.toBe('failed');
    expect(macroscope(checks, [])).toMatchObject({ verdict: 'clean', checkName: 'Macroscope - Correctness Check' });
  });

  it('reads a run with nothing new to review as the review before it, current', () => {
    for (const words of ['All code in this push has already been reviewed.', 'Diff unchanged', 'Skipped — No code objects were reviewed.']) {
      const verdict = macroscope([check('Macroscope - Correctness Check', 'skipped', words)], [thread('discussion_r1', 1, true), thread('discussion_r2', 1, false)]);
      expect(verdict, words).toMatchObject({ verdict: 'findings', count: 1, reviewedSha: HEAD });
    }
    // A real skip keeps the earlier review, behind the head, and says why when nothing was reviewed.
    const limited = check('Macroscope - Correctness Check', 'skipped', 'Per-review cost limit exceeded (workspace setting).');
    expect(macroscope([limited], [thread('discussion_r1', 1, true)])?.reviewedSha).toBe(UNKNOWN_SHA);
    expect(macroscope([limited], [])).toMatchObject({ verdict: 'failed', reason: 'Per-review cost limit exceeded (workspace setting)' });
  });

  it('takes the count from the Correctness Check until its threads are read', () => {
    expect(macroscope([check('Macroscope - Correctness Check', 'neutral', 'Completed in 3m — 8 issues identified (10 code objects reviewed).')], [])).toMatchObject({ verdict: 'findings', count: 8 });
    expect(macroscope([check('Macroscope - Correctness Check', 'neutral', '1 issue identified (12 code objects reviewed).')], [thread('discussion_r1', 1, false), thread('discussion_r2', 1, false)])).toMatchObject({ count: 2 });
  });

  it('reads Approvability as a gate: clean, a request for a person, or no word when the review did not run', () => {
    expect(parseBotBody(approvability('Approved at `2a60be7`'), 'macroscope')).toMatchObject({ clean: true, count: null });
    expect(parseBotBody(approvability('Would Approve', '\n\n**Needs human approval because:**\n- approvability is in preview mode for this repository — Macroscope would have approved this PR outside preview mode'), 'macroscope').clean).toBe(true);
    expect(parseBotBody(approvability('Needs Human Approval'), 'macroscope')).toMatchObject({ clean: false, verdict: 'needs-human' });
    expect(parseBotBody(approvabilityOnPage('Needs Human Approval'), 'macroscope')).toMatchObject({ clean: false, verdict: 'needs-human' });
    // Its explanation names findings its threads already count: no count from the words.
    expect(parseBotBody(approvability('Needs Human Approval', ' The 2 issues found remain open.'), 'macroscope').count).toBeNull();
    const unreviewed = parseBotBody(
      approvability('Would Approve', '\n\n**Needs human approval because:**\n- Per-review cost limit exceeded (workspace setting). Approvability relies on correctness review in order to determine eligibility'),
      'macroscope',
    );
    expect(isReviewShaped(unreviewed)).toBe(false);
    const limited = check('Macroscope - Correctness Check', 'skipped', 'Per-review cost limit exceeded (workspace setting).');
    // The gate's own "Needs Human Approval" over a refused review says nothing about the code either (t3code#33116).
    expect(macroscope([limited], [{ author: BOT, body: approvability('Needs Human Approval'), anchor: 'issuecomment-1', createdAt: at(2) }])).toMatchObject({ verdict: 'failed', reason: 'Per-review cost limit exceeded (workspace setting)' });
    expect(macroscope([limited], [{ author: BOT, body: approvability('Would Approve', '\n\n**Needs human approval because:**\n- Per-review cost limit exceeded (workspace setting). Approvability relies on correctness review'), anchor: 'issuecomment-1', createdAt: at(2) }])).toMatchObject({
      verdict: 'failed',
      reason: 'Per-review cost limit exceeded (workspace setting)',
    });
    // Its skip notice and a "Needs Human Approval" that only says the review did not run: the chip opens the notice,
    // whether or not the checks are on the page (a merged pull request shows none).
    const notice = { author: BOT, body: '<!-- MURMUR_IGNORE -->\n**Macroscope skipped reviewing this pull request.** Per-review cost limit exceeded (workspace setting).\n\nThis review would cost an estimated $26.45, which exceeds your per-review limit of $15.00.', anchor: 'issuecomment-1', createdAt: at(1) };
    const gate = { author: BOT, body: approvability('Needs Human Approval', '\n\n**Needs human approval because:**\n- Per-review cost limit exceeded (workspace setting). Approvability relies on correctness review in order to determine eligibility'), anchor: 'issuecomment-2', createdAt: at(2) };
    for (const checks of [[limited, check('Macroscope - Approvability Check', 'neutral', 'Needs Human Approval')], []]) {
      expect(macroscope(checks, [notice, gate]), `${checks.length} checks`).toMatchObject({ verdict: 'failed', reason: 'Per-review cost limit exceeded (workspace setting)', sourceId: 'issuecomment-1' });
      expect(macroscope(checks, [notice, gate])?.needsHuman, `${checks.length} checks`).toBeUndefined();
    }
  });

  it('marks a request for a person that found nothing, and lets a count win over it', () => {
    const gate = { author: BOT, body: approvability('Needs Human Approval'), anchor: 'issuecomment-1', createdAt: at(2) };
    const clean = check('Macroscope - Correctness Check', 'success', 'No issues identified (8 code objects reviewed).');
    expect(macroscope([clean], [gate])).toMatchObject({ verdict: 'findings', needsHuman: true, sourceId: 'issuecomment-1' });
    expect(macroscope([check('Macroscope - Correctness Check', 'neutral', '2 issues identified (8 code objects reviewed).')], [gate])).toMatchObject({ verdict: 'findings', count: 2 });
    expect(macroscope([check('Macroscope - Correctness Check', 'neutral', '2 issues identified (8 code objects reviewed).')], [gate])?.needsHuman).toBeUndefined();
    expect(macroscope([clean], [thread('discussion_r1', 1, false), gate])?.needsHuman).toBeUndefined();
    // The payload carries it, and the summary comment says it.
    const meta = { v: 1 as const, generatedAt: at(3), headSha: HEAD, producer: { kind: 'action' as const, version: '0.1.0', ai: false }, items: [], bots: [{ id: 'macroscope', login: BOT, verdict: 'findings' as const, reviewedSha: HEAD, needsHuman: true as const }], reviewers: [], fold: { comments: [], events: [] } };
    const parsed = parseGeldPrMeta(JSON.parse(JSON.stringify(meta)));
    expect(parsed.ok && parsed.value.bots[0]?.needsHuman).toBe(true);
    expect(renderSummary(meta)).toContain('Macroscope needs a human review (current)');
  });

  it("never reads a Check Run Agent's comment as the review", () => {
    expect(isMacroscopeAgentComment(AGENT_COMMENT)).toBe(true);
    expect(isMacroscopeAgentComment('The change reaches Mac only.\n\nPosted via Macroscope — Visible change evidence')).toBe(true);
    expect(isReviewShaped(parseBotBody(`Found 2 issues in the evidence.\n\n${AGENT_COMMENT}`, 'macroscope'))).toBe(false);
    expect(macroscope([], [thread('discussion_r1', 1, false), { author: BOT, body: `No issues found in the code.\n\n${AGENT_COMMENT}`, anchor: 'issuecomment-2', createdAt: at(3) }])).toMatchObject({ verdict: 'findings', count: 1 });
  });

  it("keeps the check's count when the gate approves before the threads are read", () => {
    const counted = check('Macroscope - Correctness Check', 'neutral', '8 issues identified (10 code objects reviewed).');
    for (const verdict of ['Approved at `b830bd0`', 'Would Approve']) {
      expect(macroscope([counted], [{ author: BOT, body: approvability(verdict), anchor: 'issuecomment-9', createdAt: at(2) }]), verdict).toMatchObject({ verdict: 'findings', count: 8 });
    }
    // With nothing counted, an approval is clean.
    const clean = check('Macroscope - Correctness Check', 'success', 'No issues identified (3 code objects reviewed).');
    expect(macroscope([clean], [{ author: BOT, body: approvability('Approved at `b830bd0`'), anchor: 'issuecomment-9', createdAt: at(2) }])?.verdict).toBe('clean');
  });

  it("never reads an agent's comment as a refusal or a status line", () => {
    const signed = (words: string): BotComment => ({ author: BOT, body: `${words}\n\n<sup>Posted via Macroscope — <a href="https://github.com/o/r/runs/1">Visible change evidence</a></sup>`, anchor: 'issuecomment-5', createdAt: at(3) });
    const clean = check('Macroscope - Correctness Check', 'success', 'No issues identified (3 code objects reviewed).', { startedAt: at(1), completedAt: at(2) });
    for (const words of ['Permission denied.', 'Review started for the evidence.']) {
      expect(refusalReason(signed(words).body) !== null || isStatusLineComment(signed(words).body), words).toBe(true);
      expect(macroscope([clean], [signed(words)]), words).toMatchObject({ verdict: 'clean' });
      expect(macroscope([], [thread('discussion_r1', 1, false), signed(words)]), words).toMatchObject({ verdict: 'findings', count: 1 });
    }
  });

  it('shows a Check Run Agent as a report, and neither the review nor the gate', () => {
    const agent = { name: 'Macroscope - Visible change evidence', status: 'completed', detailsUrl: 'https://github.com/o/r/pull/1/checks?check_run_id=7', description: 'Completed in 2m — Visible change: Mac evidence missing' };
    expect(readCheckReport({ ...agent, conclusion: 'neutral' })).toMatchObject({ reporter: 'macroscope', title: 'Macroscope', project: 'Visible change evidence', state: 'failed', headline: 'Visible change: Mac evidence missing' });
    expect(readCheckReport({ ...agent, conclusion: 'success', description: 'Visible change evidence: complete', detailsUrl: 'https://github.com/o/r/runs/7' })).toMatchObject({ state: 'passed' });
    expect(readCheckReport({ ...agent, conclusion: 'skipped', description: 'Prerequisite check(s) not found' })).toBeNull();
    for (const name of ['Macroscope - Correctness Check', 'Macroscope - Approvability Check']) expect(readCheckReport({ ...agent, name, conclusion: 'neutral' }), name).toBeNull();
    // A GitHub Actions job that happens to be named like one is CI.
    expect(readCheckReport({ ...agent, conclusion: 'neutral', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2' })).toBeNull();
  });

  it("reads its notices, status lines and the skip's reason", () => {
    expect(isStatusLineComment('Review started; results will appear in the PR checks.\n<!-- macroscope-meta: {"kind":"pr_assistant"} -->')).toBe(true);
    expect(isStatusLineComment('<!-- macroscope-manual-breadcrumb -->\nManual reviews triggered for commit `7f9115a`:\n- [Approvability Check](https://github.com/o/r/runs/1)\n- [Correctness Check](https://github.com/o/r/runs/2)')).toBe(true);
    expect(isStatusLineComment('Manual reviews triggered for commit 7f9115a:\n\nApprovability Check\n\nCorrectness Check\n\nAll prior checks · these links stay valid even if you push more commits.')).toBe(true);
    expect(refusalReason('<!-- MURMUR_IGNORE -->\n**Macroscope skipped reviewing this pull request.** Per-review cost limit exceeded (workspace setting).\n\nThis review would cost an estimated $12.87, which exceeds your per-review limit of $10.00.')).toBe('Per-review cost limit exceeded (workspace setting)');
  });

  it('titles a finding by its words and ranks it by its badge', () => {
    for (const [level, severity, item] of [
      ['🔴 **Critical**', 'high', 'blocking'],
      ['🟠 **High**', 'high', 'bug'],
      ['🟡 **Medium**', 'medium', 'bug'],
      ['🟢 **Low**', 'low', 'suggestion'],
    ] as const) {
      const body = finding(level, 'src/findings.ts:117', 'A finding with an unknown `repo` is verified against every clone. Distinguish the two cases.');
      expect(findingSeverity(body), level).toBe(severity);
      expect(guessSeverity(body, true, false), level).toBe(item);
      expect(firstSentence(body), level).toBe('A finding with an unknown `repo` is verified against every clone.');
    }
    // As the page reads the thread: the badge's emoji, bold and code kept.
    expect(firstSentence('🟠 **High** `src/explorer.ts:234`\n\nWhen the child exits nonzero this marks the answer complete.\n\n🚀 Reply "fix it for me" or copy this AI Prompt for your agent:')).toBe('When the child exits nonzero this marks the answer complete.');
    expect(findingSeverity('Plain words, **High** risk later.')).toBeNull();
    expect(firstSentence(approvabilityOnPage('Needs Human Approval'))).toBe('**Verdict:** Needs Human Approval');
    const [item] = clusterComments([{ anchor: 'discussion_r1', kind: 'thread', author: BOT, body: finding('🟠 **High**', 'src/findings.ts:117', 'Claims are attributed to the wrong clone.'), createdAt: at(1), path: 'src/findings.ts', line: 117 }]);
    expect(item).toMatchObject({ title: 'Claims are attributed to the wrong clone.', severity: 'bug' });
  });
});
