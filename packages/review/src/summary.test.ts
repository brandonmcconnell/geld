import { describe, expect, it } from 'vitest';
import { buildMeta } from './build';
import type { RawPullRequest } from './build';
import { encodePayloadAttribute, extractPayloadText, looksLikeSummaryBody, parseSummaryBody, parseSummaryElement } from './summary-parse';
import { renderSummary } from './summary-render';
import { PAYLOAD_BUDGET, parseGeldPrMeta } from './model';
import { botByTrigger, botsTriggeredBy, botTitle, commandReply, UNKNOWN_SHA, isReviewShaped, isStatusLineComment, looksLikeBotLogin, mergeCheckRuns, parseBotBody, refusalReason, REPORT_GRACE_MS, resolveBotId, verdictsFrom } from './bots';
import type { BotComment, DerivedBotVerdict, RawCheckRun, VerdictOptions } from './bots';
import { parseConsolidateOutput } from './prompts';

const PRODUCER = { kind: 'action' as const, version: '0.1.0', ai: false };

function fixturePr(): RawPullRequest {
  return {
    owner: 'acme',
    repo: 'widgets',
    number: 123,
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    threads: [
      {
        path: 'src/diff.ts',
        line: 42,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 1,
            author: 'cursor[bot]',
            body: 'Null check missing in parseDiff.',
            createdAt: '2026-09-18T10:00:00.000Z',
          },
          {
            databaseId: 2,
            author: 'greptile-apps[bot]',
            body: 'parseDiff should reject null.',
            createdAt: '2026-09-18T10:01:00.000Z',
          },
          {
            databaseId: 3,
            author: 'alice',
            body: 'Will fix.',
            createdAt: '2026-09-18T10:02:00.000Z',
          },
        ],
      },
      {
        path: 'src/cache.ts',
        line: 18,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 4,
            author: 'bob',
            body: 'Question: why drop the cache on rename?',
            createdAt: '2026-09-18T10:03:00.000Z',
          },
        ],
      },
      {
        path: 'src/util.ts',
        line: 7,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 6,
            author: 'devin-ai-integration[bot]',
            body: 'Unused import left behind.',
            createdAt: '2026-09-18T10:05:00.000Z',
          },
        ],
      },
    ],
    comments: [
      {
        databaseId: 88,
        author: 'greptile-apps[bot]',
        body: 'Greptile score 4/5. Found 1 issue.',
        createdAt: '2026-09-18T10:00:00.000Z',
      },
    ],
    reviews: [
      {
        databaseId: 9,
        author: 'alice',
        state: 'COMMENTED',
        body: '',
        submittedAt: '2026-09-18T10:04:00.000Z',
        commitOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
    checks: [
      {
        name: 'Cursor Bugbot',
        status: 'completed',
        conclusion: 'success',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
  };
}

describe('render / parse round trip', () => {
  it('parse(render(meta)) deep-equals meta', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const body = renderSummary(meta, { owner: 'acme', repo: 'widgets', number: 123 });
    expect(body).toContain('<!-- geld:summary:v1 -->');
    // The payload rides in an attribute, not a code block: nothing of it is visible in the rendered comment.
    expect(body).toContain("<span title='geld:");
    expect(body).not.toContain('```');
    expect(body).not.toContain('<details>');
    const parsed = parseSummaryBody(body);
    expect(parsed).toEqual({ ok: true, value: meta });
  });

  it('escapes the payload for the attribute and reads it back exactly, entities and all', () => {
    const json = JSON.stringify({ title: `Fix <b>x</b> & "y" &amp; 'z'`, n: 1 });
    const attribute = encodePayloadAttribute(json);
    expect(attribute).not.toMatch(/[<>']/);
    expect(attribute.startsWith('geld:')).toBe(true);
    const body = `<sub>Footer<span title='${attribute}'></span></sub>`;
    expect(extractPayloadText(body)).toBe(json);
    expect(looksLikeSummaryBody(body)).toBe(true);
  });

  it('still reads a summary written with the older fenced block', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const legacy = '<!-- geld:summary:v1 -->\n### Geld review summary\n\n<details><summary>Geld data</summary>\n\n```geld\n' + JSON.stringify(meta) + '\n```\n\n</details>\n';
    expect(parseSummaryBody(legacy)).toEqual({ ok: true, value: meta });
  });

  it('tolerates GitHub rendering (nbsp, smart quotes, pre lang wrapping)', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const mangled = JSON.stringify(meta).replace(/ /g, '\u00a0').replace(/-/g, '\u2013');
    const parsed = parseSummaryBody('```geld\n' + mangled + '\n```');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.headSha).toBe(meta.headSha);
  });

  it('keeps a title\u2019s inline marks as Markdown and escapes the rest', () => {
    const base = buildMeta(fixturePr(), { producer: { ...PRODUCER, ai: true }, generatedAt: '2026-09-18T12:00:00.000Z' });
    const bot = base.items.find((item) => item.sources.every((source) => source.bot !== undefined));
    expect(bot).toBeDefined();
    if (bot === undefined) return;
    const meta = buildMeta(fixturePr(), {
      producer: { ...PRODUCER, ai: true },
      generatedAt: '2026-09-18T12:00:00.000Z',
      rewritten: [{ id: bot.id, title: 'Rename `a*b` to **resolveConfig** [sic] *now*', context: 'See `x` and **y**' }],
    });
    const body = renderSummary(meta, { owner: 'acme', repo: 'widgets', number: 123 });
    expect(body).toContain('**Rename `a*b` to resolveConfig \\[sic\\] *now***');
    expect(body).toContain('See `x` and **y**');
    expect(body).not.toContain('\\`');
  });

  it('round-trips context, fixes and the TL;DR', () => {
    const base = buildMeta(fixturePr(), { producer: { ...PRODUCER, ai: true }, generatedAt: '2026-09-18T12:00:00.000Z' });
    const bot = base.items.find((item) => item.sources.every((source) => source.bot !== undefined));
    expect(bot).toBeDefined();
    if (bot === undefined) return;
    const meta = buildMeta(fixturePr(), {
      producer: { ...PRODUCER, ai: true },
      generatedAt: '2026-09-18T12:00:00.000Z',
      rewritten: [{ id: bot.id, title: 'Remove the unused import', context: 'Left behind by the refactor.', fix: '-import { x } from "y";' }],
      suggestedFixes: 'all',
      summary: { tldr: 'One bot nit and one open question; nothing blocking.', updatedAt: '2026-09-18T12:00:00.000Z', forItems: base.items.map((item) => item.id).sort() },
    });
    const item = meta.items.find((entry) => entry.id === bot.id);
    expect(item?.context).toBe('Left behind by the refactor.');
    expect(item?.fix).toEqual({ text: '-import { x } from "y";', source: 'ai' });
    const body = renderSummary(meta, { owner: 'acme', repo: 'widgets', number: 123 });
    expect(body).toContain('nothing blocking');
    expect(parseSummaryBody(body)).toEqual({ ok: true, value: meta });
    const noFixes = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z', rewritten: [{ id: bot.id, title: 'x', fix: 'y' }], suggestedFixes: 'off' });
    expect(noFixes.items.find((entry) => entry.id === bot.id)?.fix).toBeUndefined();
  });

  it('reads a QueryRoot the way GitHub renders the carrier span (title decoded by the browser)', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const json = JSON.stringify(meta);
    const parsed = parseSummaryElement({
      textContent: 'Geld review summary … Maintained by Geld',
      querySelector: (selector: string) => (selector.startsWith('span[title^=') ? { textContent: '', getAttribute: (name: string) => (name === 'title' ? `geld:${json}` : null) } : null),
    });
    expect(parsed).toEqual({ ok: true, value: meta });
  });

  it('reads a QueryRoot the way GitHub renders <pre lang="geld">', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const withNbsp = JSON.stringify(meta).replace(/: /g, ':\u00a0');
    const parsed = parseSummaryElement({
      textContent: withNbsp,
      querySelector: (selector: string) => (selector.includes('lang="geld"') ? { textContent: withNbsp } : null),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items.length).toBe(meta.items.length);
  });

  it('keeps a 200-thread payload under budget, truncating closed items first', () => {
    const threads = Array.from({ length: 200 }, (_, index) => ({
      path: `src/f${index}.ts`,
      line: index + 1,
      isResolved: index >= 40,
      isOutdated: false,
      comments: [
        {
          databaseId: 1000 + index,
          author: index % 2 === 0 ? 'cursor[bot]' : 'alice',
          body: `Finding number ${index}: ${'x'.repeat(80)}`,
          createdAt: '2026-09-18T10:00:00.000Z',
        },
      ],
    }));
    const pr: RawPullRequest = { ...fixturePr(), threads };
    const built = buildMeta(pr, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const body = renderSummary(built);
    expect(encodePayloadAttribute(JSON.stringify(built)).length).toBeLessThanOrEqual(PAYLOAD_BUDGET + 'geld:'.length);
    expect(body.length).toBeLessThan(65_536);
    if (built.truncated === true) {
      expect(built.items.some((item) => item.status === 'open')).toBe(true);
    }
  });
});

describe('buildMeta', () => {
  it('clusters the nearby bot thread, keeps the human question, and records bot verdicts', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    expect(meta.items.length).toBeGreaterThanOrEqual(2);
    const human = meta.items.find((item) => item.sources.some((source) => source.author === 'bob'));
    expect(human?.title).toMatch(/why drop the cache/i);
    expect(human?.status).toBe('open');
    // Bugbot's check is green, but its thread is open: the thread is the finding, as the page reads it too.
    expect(meta.bots.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r1' });
    expect(meta.bots.some((bot) => bot.id === 'greptile')).toBe(true);
    expect(meta.reviewers).toEqual([{ login: 'alice', state: 'commented' }]);
    expect(meta.fold.comments).toContain('issuecomment-88');
    // The thread resolved: nothing outstanding — "resolved" (findings, none open), with or without the green check,
    // since the check passing is not the bot looking again.
    const pr = fixturePr();
    const resolvedThreads = pr.threads.map((thread, index) => (index === 0 ? { ...thread, isResolved: true } : thread));
    expect(buildMeta({ ...pr, threads: resolvedThreads }, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' }).bots.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 0 });
    expect(buildMeta({ ...pr, checks: [], threads: resolvedThreads }, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' }).bots.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 0 });
  });

  it('reads a review body before the threads it was pending with, whatever their timestamps', () => {
    // A bot drafts its inline comments, then submits the review: the thread comments predate the body's submit.
    // Read in that order the body would set the threads aside; the body goes first, as it stands on the page.
    const pr: RawPullRequest = {
      ...fixturePr(),
      checks: [],
      reviews: [{ databaseId: 70, author: 'cursor[bot]', state: 'COMMENTED', body: 'Cursor Bugbot has reviewed your changes and found 1 potential issue.', submittedAt: '2026-09-18T10:00:30.000Z', commitOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
      threads: [{ path: 'src/diff.ts', line: 42, isResolved: true, isOutdated: false, comments: [{ databaseId: 71, author: 'cursor[bot]', body: 'Null check missing in parseDiff.', createdAt: '2026-09-18T10:00:00.000Z' }] }],
      comments: [],
    };
    expect(buildMeta(pr, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' }).bots.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r71' });
    // Still open: the thread is the finding.
    const open = { ...pr, threads: pr.threads.map((thread) => ({ ...thread, isResolved: false })) };
    expect(buildMeta(open, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' }).bots.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r71' });
  });

  it('carries done-manual from a ticked previous comment', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const ticked = renderSummary(first).replace('- [ ]', '- [x]');
    const second = buildMeta(fixturePr(), {
      producer: PRODUCER,
      generatedAt: '2026-09-18T12:05:00.000Z',
      previous: first,
      previousBody: ticked,
    });
    expect(second.items.some((item) => item.status === 'done-manual')).toBe(true);
  });

  it('rewrites bot-only titles when the model output is valid', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const botItem = first.items.find((item) => item.sources.every((source) => source.bot !== undefined));
    expect(botItem).toBeDefined();
    if (botItem === undefined) return;
    const rewritten = buildMeta(fixturePr(), {
      producer: { ...PRODUCER, ai: true },
      generatedAt: '2026-09-18T12:00:00.000Z',
      rewritten: [{ id: botItem.id, title: 'Guard parseDiff against null input' }],
    });
    expect(rewritten.items.find((item) => item.id === botItem.id)?.title).toBe('Guard parseDiff against null input');
    expect(rewritten.items.find((item) => item.id === botItem.id)?.rewritten).toBe(true);
  });

  it('marks a finding addressed only when a later push touched its path', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const bot = first.items.find((item) => item.path === 'src/diff.ts');
    expect(bot?.status).toBe('needs-reply');
    const later = buildMeta(
      { ...fixturePr(), changedPaths: ['src/diff.ts'] },
      { producer: PRODUCER, generatedAt: '2026-09-18T12:10:00.000Z' },
    );
    expect(later.items.find((item) => item.path === 'src/diff.ts')?.status).toBe('addressed');
  });
});

describe('bots + prompts', () => {
  it('reads a count through one qualifier ("1 potential issue")', () => {
    expect(parseBotBody('Cursor Bugbot has reviewed your changes using default effort and found 1 potential issue.', 'bugbot')).toMatchObject({ count: 1, clean: false });
    expect(parseBotBody('Found 3 new bugs.', 'bugbot')).toMatchObject({ count: 3 });
    expect(parseBotBody('Bugbot reviewed your changes and found no new issues!', 'bugbot')).toMatchObject({ count: null, clean: true });
  });

  it('reads CodeRabbit\u2019s review words', () => {
    // geld#36: the summary comment, edited in place from "Currently processing…" to this, is the clean word.
    expect(parseBotBody('No actionable comments were generated in the recent review. \u{1F389}\n\n<details><summary>Recent review info</summary></details>', 'coderabbit')).toMatchObject({ clean: true });
    // geld#37: each review body counts its findings the other way round.
    expect(parseBotBody('**Actionable comments posted: 1**\n---\nPrompt to fix review comments', 'coderabbit')).toMatchObject({ count: 1, clean: false });
    expect(parseBotBody('**Actionable comments posted: 0**', 'coderabbit')).toMatchObject({ count: 0, clean: true });
    const now = Date.UTC(2026, 9, 14, 16, 0);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    expect(verdictsFrom([], [{ author: 'coderabbitai[bot]', body: 'No actionable comments were generated in the recent review. \u{1F389}', anchor: 'issuecomment-1', createdAt: at(60) }], 'aaa', [], now)[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-1' });
    // The same comment as first posted, a note over the run configuration: a status line, however long the comment.
    const processing = '> [!NOTE]\n> Currently processing new changes in this PR. This may take a few minutes, please wait...\n> \n> <details>\n> <summary><strong>Run configuration</strong></summary>\n> - **Configuration used**: defaults\n> - **Review profile**: CHILL\n> - **Plan**: Advanced\n> - **Run ID**: `4ba79fb3-4c73-48d2-8735-290eee0536a9`\n> </details>\n> <details><summary>Commits</summary>Reviewing files that changed from the base of the PR and between 26a5bac and a9885e3.</details>';
    expect(isStatusLineComment(processing)).toBe(true);
    expect(verdictsFrom([], [{ author: 'coderabbitai[bot]', body: processing, anchor: 'issuecomment-1', createdAt: at(2) }], 'aaa', [], now)[0]?.verdict).toBe('running');
    // As the page reads it: GitHub renders the alert with a "Note" heading, which the crawl's block text keeps on a
    // line of its own before the sentence, and the run configuration's lines follow.
    const rendered = 'Note\nCurrently processing new changes in this PR. This may take a few minutes, please wait...\nRun configuration\nConfiguration used: defaults\nReview profile: CHILL\nPlan: Advanced\nRun ID: 4ba79fb3-4c73-48d2-8735-290eee0536a9\nCommits\nReviewing files that changed from the base of the PR and between 26a5bac and a9885e3.\nFiles selected for processing: 1\napps/extension/entrypoints/github.content/style.css';
    expect(isStatusLineComment(rendered)).toBe(true);
    expect(verdictsFrom([], [{ author: 'coderabbitai[bot]', body: rendered, anchor: 'issuecomment-1', createdAt: at(2) }], 'aaa', [], now)[0]?.verdict).toBe('running');
    // A long review whose first sentence only begins with those words is a review: the whole sentence must be the
    // status line for the long-comment rule to take it.
    const review = `Currently processing changes in this PR file by file was slow, so here is the review in one go. ${'Found 2 issues, both in the parser. '.repeat(8)}`;
    expect(isStatusLineComment(review)).toBe(false);
    // The line whole, then only the run's metadata (as the note reads without the alert wrapper): a status line.
    const metadata = 'Run configuration. Configuration used: defaults. Review profile: CHILL. Plan: Advanced. Run ID: 59ebdae6-47fb-4c41-81ea-3fd58656c897. Commits: reviewing files that changed between ee33672 and aed3212. Files selected for processing: 3.';
    expect(isStatusLineComment(`Currently processing changes in this PR. ${metadata}`)).toBe(true);
  });

  it('parses greptile scores and known logins', () => {
    expect(looksLikeBotLogin('cursor[bot]')).toBe(true);
    expect(parseBotBody('Greptile 4/5. Found 1 issue.', 'greptile')).toEqual({ count: 1, score: 4, clean: false, severity: null });
    // Greptile's summary lists its findings under a "Findings" heading; one without the section found nothing, however
    // its risk sentence is worded (mint#12992: 5/5, "This PR appears safe to merge", no findings — read as findings,
    // the chip said 5/5 but the request menu pre-ticked Greptile over "Findings").
    const cleanRaw = '<!-- greptile_summary -->\n\n<h2><a href="https://app.greptile.com/api/retrigger?id=1"><img alt="Retrigger"></a>Confidence Score: 5/5</h2>\n\n<!-- greptile-risk -->\n\n**[Low impact]** This PR appears safe to merge.\n\n<!-- greptile_confidence_score:5 -->\n\n<sub>Reviews (1) · Last reviewed commit: ["Make test-hygiene…"](https://github.com/o/r/commit/abc) · [Reviewed by Greptile](https://www.greptile.com/)</sub>';
    expect(parseBotBody(cleanRaw, 'greptile')).toMatchObject({ count: 0, score: 5, clean: true });
    expect(parseBotBody('Confidence Score: 5/5\n[Low impact] This PR appears safe to merge.\nReviews (1) · Last reviewed commit: "Make test-hygiene presentation assertion..." · Reviewed by Greptile', 'greptile')).toMatchObject({ count: 0, score: 5, clean: true });
    // With the section, its bold titles are the findings — raw ("1. **…** ▶") and as the page reads the list.
    const findingsRaw = '<h2>Confidence Score: 4/5</h2>\n\nThe PR appears safe to merge, with a non-blocking request for a focused regression test.\n\n<h2>Findings</h2>\n\n1. <img alt="P2">&nbsp;**Review cards lack test coverage** <a href="#">▶</a>\n2. <img alt="P2">&nbsp;**Another one** <a href="#">▶</a>\n\n<details><summary><h3>Summary</h3></summary>\n\nThe PR lets a review\u2019s own body card render as a dressed chat message.\n</details>';
    expect(parseBotBody(findingsRaw, 'greptile')).toMatchObject({ count: 2, score: 4, clean: false });
    expect(parseBotBody('Confidence Score: 4/5\n[Medium impact] Adjusts how review comments are identified.\nThe PR appears safe to merge, with a non-blocking request.\nFindings\n\n**Review cards lack test coverage** ▶\n\nSummary\nThe PR lets a review\u2019s own body card render as a dressed chat message.', 'greptile')).toMatchObject({ count: 1, score: 4, clean: false });
    // A Findings section whose items cannot be read claims nothing either way.
    expect(parseBotBody('Confidence Score: 3/5\nFindings\nsomething unreadable\nSummary\nwords', 'greptile')).toMatchObject({ count: null, clean: false });
    expect(parseBotBody('1 high severity bug found.', 'bugbot').severity).toBe('high');
    // A denied severity word is not a severity: Greptile's "[Medium risk] ... no established behavioral blocker" is medium, not high.
    // (A scored summary with no Findings section counts as none found; this one-liner has none, so it is clean with its score.)
    expect(parseBotBody('Confidence Score: 4/5 [Medium risk] The implementation has no established behavioral blocker, but tests are required.', 'greptile')).toEqual({ count: 0, score: 4, clean: true, severity: 'medium' });
    expect(parseBotBody('No critical issues. 2 issues found.', 'bugbot').severity).toBeNull();
    // Survey of public pull requests, Oct 2026 — wordings that read as findings and are not:
    // Devin: two qualifiers before the noun ("1 new potential issue").
    expect(parseBotBody('**Devin Review** found 1 new potential issue. <a href="https://app.devin.ai/review/o/r/pull/1"><img alt="Devin Review"></a>', 'devin')).toMatchObject({ count: 1, clean: false });
    // Codex: "Didn't find any major issues".
    expect(parseBotBody("Codex Review: Didn't find any major issues. Great work!", 'codex')).toMatchObject({ clean: true });
    // ...but not beside a count of findings: the count is the word.
    expect(parseBotBody("Didn't find any major issues. Found 2 minor issues.", 'codex')).toMatchObject({ clean: false, count: 2 });
    expect(parseBotBody('Verdict: approve. Found 1 minor issue worth a look.', 'bugbot')).toMatchObject({ clean: false, count: 1 });
    // ...and a finding whose title begins with the word is not the verdict word.
    expect(parseBotBody('Approved users can edit another tenant\u2019s settings because the guard checks the role, not the tenant.', 'bugbot')).toMatchObject({ clean: false });
    expect(parseBotBody('Approved: Cursor Bugbot is skipped after a usage-limit failure, so that automated-review signal is omitted rather than treated as findings.', 'bugbot')).toMatchObject({ clean: true });
    expect(parseBotBody('**Approved**. No applicable approval policy required human review on this head.', 'bugbot')).toMatchObject({ clean: true });
    expect(parseBotBody('**Approved**', 'bugbot')).toMatchObject({ clean: true });
    // A Cursor automation's review under the Bugbot login: its verdict is the word, behind its own HTML-comment marker.
    expect(parseBotBody('<!-- CURSOR_AUTOMATION_ID: 16f0 | RUN_ID: bc-62 -->\nApproved. Cursor Bugbot was skipped, so that reviewer signal was not used. No applicable approval policy required human review on this head.', 'bugbot')).toMatchObject({ clean: true });
    expect(parseBotBody('<!-- CURSOR_AUTOMATION_ID: 16f0 -->\nVerdict: approve <div><a href="https://cursor.com/agents/bc-1"><img alt="Open in Web"></a></div>', 'bugbot')).toMatchObject({ clean: true });
    expect(parseBotBody('<!-- CURSOR_AUTOMATION_ID: 16f0 -->\nVerdict: request changes **Blocking:** per-worker floors are applied after the free-memory split.', 'bugbot')).toMatchObject({ clean: false, count: null, verdict: 'changes-requested' });
    // A Cursor cloud agent under the same login talking to another bot is not Bugbot's review: with Bugbot's clean
    // summary standing, the chip stayed clean, not amber "findings" with no count (mint#13111).
    const agentTalk = verdictsFrom(
      [],
      [
        { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-1', createdAt: '2026-10-18T08:33:55Z' },
        { author: 'cursor[bot]', body: '✅ Bugbot reviewed your changes and found no new issues!\n\nReviewed by Cursor Bugbot for commit 430cad1.', anchor: 'pullrequestreview-2', createdAt: '2026-10-18T08:39:32Z' },
        // (The agent's replies inside Greptile's threads are Greptile's threads to the crawl, which keys a thread on
        // its first comment, so nothing of Bugbot's is between the review and the remark.)
        { author: 'cursor[bot]', body: '@greptileai Both P1 findings are addressed in 0131126 and 446b6de (see thread replies). Please re-review.', anchor: 'issuecomment-5', createdAt: '2026-10-18T08:46:42Z' },
      ],
      'aaa',
      [],
      Date.parse('2026-10-18T10:00:00Z'),
    );
    expect(agentTalk[0]).toMatchObject({ id: 'bugbot', verdict: 'clean', sourceId: 'pullrequestreview-2' });
    // A deploy bot's comment is not a review verdict.
    expect(verdictsFrom([], [{ author: 'vercel[bot]', body: 'Deployment ready', anchor: 'issuecomment-5' }], 'aaa')).toEqual([]);
    expect(verdictsFrom([], [{ author: 'acme[bot]', body: 'Found 2 issues', anchor: 'issuecomment-6' }], 'aaa', ['acme[bot]'])[0]?.count).toBe(2);
    const verdicts = verdictsFrom(
      [{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha: 'aaa' }],
      [],
      'aaa',
    );
    expect(verdicts[0]?.verdict).toBe('clean');
  });

  it('does not read a #reference as a count', () => {
    // server#9385: a Cursor automation's review under the Bugbot login, "I checked both #9377 findings against the
    // code, and both are fixed" — a pull request, not 9,377 findings; the summary is clean ("no blocking findings").
    const parsed = parseBotBody('AppSec review: no blocking findings. I checked both #9377 findings against the code, and both are fixed: Medium (stale cross-org subscribers still emailed): fixed.', 'bugbot');
    expect(parsed).toMatchObject({ count: null, clean: true });
    expect(parseBotBody('Found 2 issues, see #9377 issues for the earlier ones.', 'bugbot').count).toBe(2);
    expect(parseBotBody('Fixes GH-123 issues: found 1 bug.', 'bugbot').count).toBe(1);
  });
  it("reads Copilot's overview: open findings counted, none open is clean", () => {
    // Copilot code review's overview (`ccr-overview-v2`, Oct 2026): a verdict heading, then "**1 open finding**" /
    // "**0 open findings**" / "**No open issues** 🎉", edited as the findings are resolved.
    expect(parseBotBody('### 🟢 Approval recommended\n\nThe changes are additive.\n\n<details open><summary><strong>1 open finding</strong></summary>\n- Low severity [Document the language requirements](https://github.com/o/r/pull/1#discussion_r1) · New\n</details>', 'copilot')).toMatchObject({ count: 1, clean: false });
    expect(parseBotBody('### 🟢 Approval recommended\n\nThe remaining note is non-blocking.\n\n**0 open findings**', 'copilot')).toMatchObject({ count: 0, clean: true });
    // "Needs a closer look … needs human review" with none open: a stated verdict, not clean, and nothing outstanding.
    expect(parseBotBody('### 🔵 Needs a closer look\n\nCompatibility remains unverified and needs human review.\n\n**0 open findings**', 'copilot')).toMatchObject({ count: 0, clean: false, verdict: 'needs-human' });
    expect(parseBotBody('### 🔵 Needs a closer look\n\nCorrectness depends on in-game outcomes.\n\n**No open issues** 🎉\n\n<details><summary><strong>What changed in this PR</strong></summary>…</details>', 'copilot')).toMatchObject({ count: null, clean: true });
    expect(refusalReason('Copilot was unable to review this pull request because the user who requested the review has reached their quota limit.')).toBe('Copilot was unable to review this pull request because the user who requested the review has reached their quota limit');
    // A summary rewritten well after the threads whose words give no count does not outrank the threads: every one
    // resolved reads "resolved", not amber "findings" from a rewrite the parser could not read (mint#13111).
    const now = Date.UTC(2026, 9, 18, 9, 0);
    const t = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    const rewritten = verdictsFrom(
      [],
      [
        { author: 'copilot-pull-request-reviewer[bot]', body: '### 🟡 Changes recommended\n\nTwo things to look at.\n\n**Findings below.**', anchor: 'pullrequestreview-1', createdAt: t(120), editedAt: t(10) },
        { author: 'copilot-pull-request-reviewer[bot]', body: 'Off by one.', anchor: 'discussion_r1', createdAt: t(119), resolved: true },
        { author: 'copilot-pull-request-reviewer[bot]', body: 'Unused import.', anchor: 'discussion_r2', createdAt: t(119), resolved: true },
      ],
      'aaa',
      [],
      now,
    );
    expect(rewritten[0]).toMatchObject({ id: 'copilot', verdict: 'findings', count: 0, sourceId: 'discussion_r2' });
    // A rewrite that counts still stands as the latest word (Greptile's re-review into the same comment).
    const counted = verdictsFrom(
      [],
      [
        { author: 'greptile-apps[bot]', body: 'Confidence Score: 3/5\n\n## Findings\n\n1. **Leaked handle** ▶\n2. **Stale cache** ▶\n\n## Summary\nTwo things remain.', anchor: 'issuecomment-1', createdAt: t(120), editedAt: t(10) },
        { author: 'greptile-apps[bot]', body: 'Leaked handle.', anchor: 'discussion_r1', createdAt: t(119), resolved: true },
      ],
      'aaa',
      [],
      now,
    );
    expect(counted[0]).toMatchObject({ id: 'greptile', verdict: 'findings', count: 2, sourceId: 'issuecomment-1' });
    // A counted summary, then a newer one with no count of its own: the number on the record is the older summary's,
    // so the newer rewrite does not stand over the resolved threads either.
    const inherited = verdictsFrom(
      [],
      [
        { author: 'copilot-pull-request-reviewer[bot]', body: '### 🟡 Changes recommended\n\n**2 open findings**', anchor: 'pullrequestreview-1', createdAt: t(240) },
        { author: 'copilot-pull-request-reviewer[bot]', body: 'Off by one.', anchor: 'discussion_r1', createdAt: t(239), resolved: true },
        { author: 'copilot-pull-request-reviewer[bot]', body: '### 🟡 Changes recommended\n\nStill worth a look.\n\n**Findings below.**', anchor: 'pullrequestreview-2', createdAt: t(120), editedAt: t(10) },
        { author: 'copilot-pull-request-reviewer[bot]', body: 'Unused import.', anchor: 'discussion_r2', createdAt: t(119), resolved: true },
      ],
      'aaa',
      [],
      now,
    );
    expect(inherited[0]).toMatchObject({ id: 'copilot', verdict: 'findings', count: 0, sourceId: 'discussion_r2' });
  });

  
  it("reads a check's conclusion in the bot's own words", () => {
    // Bugbot's docs: `neutral` is its default for a run that found something; `failure` only when configured to
    // fail on unresolved findings. CodeRabbit's check is neutral on completion and says nothing about the code.
    expect(verdictsFrom([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'neutral', sha: 'aaa' }], [], 'aaa')[0]).toMatchObject({ id: 'bugbot', verdict: 'findings', checkName: 'Cursor Bugbot' });
    expect(verdictsFrom([{ name: 'CodeRabbit', status: 'completed', conclusion: 'neutral', sha: 'aaa' }], [], 'aaa')[0]).toMatchObject({ id: 'coderabbit', verdict: 'clean' });
    // Findings the bot then posted as threads carry the count.
    const threads = verdictsFrom(
      [{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'neutral', sha: 'aaa' }],
      [
        { author: 'cursor[bot]', body: 'Off by one.', anchor: 'discussion_r1', resolved: false },
        { author: 'cursor[bot]', body: 'Unused import.', anchor: 'discussion_r2', resolved: true },
      ],
      'aaa',
    );
    expect(threads[0]).toMatchObject({ verdict: 'findings', count: 1 });
    // A request the bot answered only through its check (the partial shows no start): the neutral still speaks.
    const asked = verdictsFrom(
      [{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'neutral', sha: 'aaa' }],
      [{ author: 'octocat', body: 'bugbot run', anchor: 'issuecomment-9', createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
      'aaa',
    );
    expect(asked[0]).toMatchObject({ id: 'bugbot', verdict: 'findings' });
    // Every thread of a neutral run resolved: resolved, as with a green check.
    const resolved = verdictsFrom(
      [{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'neutral', sha: 'aaa' }],
      [{ author: 'cursor[bot]', body: 'Unused import.', anchor: 'discussion_r2', resolved: true }],
      'aaa',
    );
    expect(resolved[0]).toMatchObject({ verdict: 'findings', count: 0 });
    // A skipped check is a run the bot did not make, in its word.
    expect(verdictsFrom([{ name: 'CodeRabbit', status: 'completed', conclusion: 'skipped', sha: 'aaa' }], [], 'aaa')[0]).toMatchObject({ verdict: 'failed', reason: 'Check skipped' });
    // A finished check whose start is known and that no word followed: neutral is still findings.
    const started = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const finished = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(verdictsFrom([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'neutral', sha: 'aaa', startedAt: started, completedAt: finished }], [], 'aaa')[0]).toMatchObject({ verdict: 'findings', runJudged: true });
    // The Autofix check is the same App's other job, not the review.
    expect(verdictsFrom([{ name: 'Cursor Bugbot Autofix', status: 'completed', conclusion: 'success', sha: 'aaa' }], [], 'aaa')).toEqual([]);
    // Two readings of the head's checks: the page's live rows win by name, the commit partial fills in the rest.
    expect(
      mergeCheckRuns(
        [{ name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha: 'aaa', startedAt: started }],
        [
          { name: 'cursor bugbot', status: 'completed', conclusion: 'success', sha: 'aaa' },
          { name: 'Greptile', status: 'completed', conclusion: 'success', sha: 'aaa' },
        ],
      ),
    ).toEqual([
      { name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha: 'aaa', startedAt: started },
      { name: 'Greptile', status: 'completed', conclusion: 'success', sha: 'aaa' },
    ]);
  });

  it('reads the bots added in Oct 2026 in their own words (public pull requests, survey)', () => {
    // Claude Code Review: summaries, the P1/P2 count line, status checklists, errors and skips.
    expect(parseBotBody('I reviewed this PR and found no bugs (no blocking findings). The change alters when consolidation merges rows, so someone should still check the tradeoff.', 'claude').clean).toBe(true);
    expect(parseBotBody('**Nothing blocking.** The comments below are optional suggestions. There is no need to push a fix for them before merging.', 'claude').clean).toBe(true);
    expect(parseBotBody('## Code review\nNo issues found. Checked for bugs and CLAUDE.md compliance at f60572f.', 'claude').clean).toBe(true);
    expect(parseBotBody("**Claude finished @x's task in 9m 35s** —— [View job](https://github.com/o/r/actions/runs/1)\n\n---\n### Review complete — approved (0 P1, 0 P2, 2 P3)", 'claude')).toMatchObject({ clean: true, count: 0 });
    expect(parseBotBody("**Claude finished @x's task in 8m 41s** —— [View job](https://github.com/o/r/actions/runs/1)\n\n---\n### Review complete — changes requested (0 P1, 3 P2, 3 P3)", 'claude')).toMatchObject({ clean: false, count: 3 });
    expect(parseBotBody('Has P1/P2 findings, changes requested: 1 P1, 1 P2, 2 P3. P1 — `_ensure` attaches the wrong id.', 'claude').count).toBe(2);
    expect(isStatusLineComment('Reviewing PR #396 <img src="x" width="14px">\n- [x] Gather context\n- [ ] Read AGENTS.md\n- [ ] Review diff (oidata, likelihood, plotting, docs, tests)\n- [ ] Post inline findings')).toBe(true);
    expect(refusalReason('**Claude encountered an error after 48s** —— [View job](https://github.com/o/r/actions/runs/1)\n\n---\n### Review in progress <img src="x">\n- [x] Read repo conventions\n- [ ] Review the diff and all the files it touches, one by one, with the surrounding code in view, then write the findings up')).toBe('Claude encountered an error after 48s');
    expect(refusalReason('## Claude Code Review\nThis pull request is from a fork — automated review is disabled. A repository maintainer can comment `@claude review` to run a one-time review.')).toBe('This pull request is from a fork — automated review is disabled');
    expect(refusalReason("⚠️ **Code review skipped:** your organization has reached its API usage limit, so Code Review can't run right now. An organization admin can review the limit in your organization's usage and billing settings.")).toBe('⚠️ Code review skipped: your organization has reached its API usage limit, so Code Review can\'t run right now');
    expect(botsTriggeredBy('@claude review always').map((bot) => bot.id)).toEqual(['claude']);
    // cubic: the bold count line, existing + new, "all addressed".
    expect(parseBotBody('**1 existing issue remains and 3 new issues found** across 26 files', 'cubic')).toMatchObject({ clean: false, count: 4 });
    expect(parseBotBody('**1 existing issue remains and no new issues found** across 1 file', 'cubic')).toMatchObject({ clean: false, count: 1 });
    expect(parseBotBody('**No issues found** across 2 files', 'cubic')).toMatchObject({ clean: true, count: 0 });
    expect(parseBotBody('**All reported issues were addressed** across 3 files', 'cubic')).toMatchObject({ clean: true, count: 0 });
    expect(parseBotBody('**0 issues found across 3 files (changes from recent commits).**\n\nConfidence score: **5/5**', 'cubic')).toMatchObject({ clean: true, count: 0, score: 5 });
    expect(parseBotBody('**2 issues found** across 9 files\n\nConfidence score: **3/5**', 'cubic')).toMatchObject({ clean: false, count: 2, score: 3 });
    expect(botsTriggeredBy('@cubic-dev-ai review this PR').map((bot) => bot.id)).toEqual(['cubic']);
    // Sourcery: the assessment, the budget and size refusals, the guide (not a verdict).
    expect(parseBotBody("Hey - I've reviewed your changes and they look great!\n\n### Sourcery assessment\n\n**Approved.**", 'sourcery').clean).toBe(true);
    expect(parseBotBody("Hey - I've reviewed your changes and they look great!\n\n### Sourcery assessment\n\n**Needs a human reviewer.** When lane-3 credits run out the narrator falls back silently.", 'sourcery').clean).toBe(false);
    expect(parseBotBody("Hey - I've found 2 issues\n\n<details><summary>Prompt for AI Agents</summary>…</details>", 'sourcery').count).toBe(2);
    expect(refusalReason("Sorry @arthrod, you've used your own review budget of 250,000 diff characters for the last 7 days. You can request another review in 3 days and 3 hours by commenting `@sourcery-ai review`.")).toBe("Sorry @arthrod, you've used your own review budget of 250,000 diff characters for the last 7 days");
    expect(refusalReason('Sorry @leynos, your pull request is larger than the review limit of 150,000 diff characters')).toBe('Sorry @leynos, your pull request is larger than the review limit of 150,000 diff characters');
    expect(parseBotBody("## Reviewer's Guide\nThis PR preserves header and footer alignment across round trips.", 'sourcery')).toMatchObject({ clean: false, count: null, score: null });
    // Qodo: the pills, the busy line, the billing pause.
    expect(parseBotBody('<h3>Code Review by Qodo</h3>\n\n<code>🐞 Bugs (0)</code> <code>📘 Rule violations (0)</code> <code>📎 Requirement gaps (0)</code> <code>🔗 Cross-repo conflicts (0)</code> <code>📜 Skill insights (0)</code>', 'qodo')).toMatchObject({ clean: true, count: 0, score: null });
    expect(parseBotBody('<h3>Code Review by Qodo</h3>\n\n<code>🐞 Bugs (2)</code> <code>📘 Rule violations (1)</code> <code>📎 Requirement gaps (0)</code>', 'qodo')).toMatchObject({ clean: false, count: 3 });
    expect(isStatusLineComment("<h3>Qodo is busy working</h3>\nCheck back in a few minutes. Qodo's code review agents are on it.")).toBe(true);
    expect(refusalReason('**ⓘ Qodo reviews are paused because your trial has ended.** Ask your workspace admin to add credits to resume reviews. [Manage billing](https://app.qodo.ai/account/billing)')).toBe('ⓘ Qodo reviews are paused because your trial has ended');
    expect(botsTriggeredBy('/agentic_review').map((bot) => bot.id)).toEqual(['qodo']);
    // Amazon Q Developer: the summary's closing sentence.
    expect(parseBotBody('## Review Summary\nThis PR removes a single committed mock file. **No blocking defects were found in the changes introduced by this PR.**', 'amazon-q').clean).toBe(true);
    expect(parseBotBody('## Review Summary\nNo logic errors, security vulnerabilities, crashes, or behavioral regressions were found in the changed code. The PR is ready to merge.', 'amazon-q').clean).toBe(true);
    expect(parseBotBody('## Review Summary\nThis PR adds a guard, which is the right intent. However, the implementation has a gap that is not ready to merge.', 'amazon-q').clean).toBe(false);
    expect(parseBotBody('## Review Summary\nThis PR is not yet ready to merge: the handler swallows the error.', 'amazon-q').clean).toBe(false);
    expect(parseBotBody("## Review Summary\nThe migration isn't ready to merge until the index exists.", 'amazon-q').clean).toBe(false);
    expect(botsTriggeredBy('/q review').map((bot) => bot.id)).toEqual(['amazon-q']);
    // Ellipsis, Macroscope, Korbit, Entelligence.
    expect(parseBotBody('> [!IMPORTANT]\n> **Looks good to me! :+1:**\n> <details><summary>Reviewed everything up to d514768 in 10 seconds.</summary></details>', 'ellipsis').clean).toBe(true);
    expect(parseBotBody('#### Approvability\n**Verdict:** Approved at `2a60be7`\n\nMacroscope\'s review found this PR approvable — a narrowly scoped fix.', 'macroscope').clean).toBe(true);
    expect(parseBotBody('#### Approvability\n**Verdict:** Would Approve\n\nMacroscope\'s review found this PR approvable.', 'macroscope').clean).toBe(true);
    expect(parseBotBody('#### Approvability\n**Verdict:** Needs Human Approval\n\nMacroscope\'s review found this PR requires human approval — an unresolved finding.', 'macroscope').clean).toBe(false);
    expect(refusalReason('**Macroscope skipped reviewing this pull request.** Per-review cost limit exceeded (workspace setting). This review would cost an estimated $25.00, which exceeds your per-review limit of $10.00. An admin can raise the limit in workspace settings, or comment `@macroscope-app review` to run it anyway at the estimated cost shown above, which is billed to the workspace.')).toBe('Macroscope skipped reviewing this pull request');
    const korbit = '### Review by Korbit AI\n###### Korbit automatically attempts to detect when you fix issues in new commits.\n| Category | Issue | Status |\n|---|---|---|\n| <sub>![Security](https://img.shields.io/badge/Security-e11d48)</sub> | Overly broad exception handler ▹ [view](https://github.com/o/r/pull/1#discussion_r1) | ✅ Fix detected |\n| <sub>![Functionality](https://img.shields.io/badge/Functionality-0284c7)</sub> | Downgrade fails with duplicate tag names ▹ [view](https://github.com/o/r/pull/1#discussion_r2) ||';
    expect(parseBotBody(korbit, 'korbit')).toMatchObject({ clean: false, count: 1 });
    // ...and as the page reads the table (a row per line, the cells' words run together, the badge image silent).
    const korbitRendered = 'Review by Korbit AI\nKorbit automatically attempts to detect when you fix issues in new commits.\n\nCategory Issue Status\n\nOverly broad exception handler in database driver detection ▹ view ✅ Fix detected\n\nDowngrade fails with duplicate tag names ▹ view\n\nFiles scanned';
    expect(parseBotBody(korbitRendered, 'korbit')).toMatchObject({ clean: false, count: 1 });
    expect(parseBotBody(korbitRendered.replace('Downgrade fails with duplicate tag names ▹ view\n\n', ''), 'korbit')).toMatchObject({ clean: true, count: 0 });
    expect(refusalReason("By default, I don't review pull requests opened by bots. If you would like me to review this pull request anyway, you can request a review via the `/korbit-review` command.")).toBe("By default, I don't review pull requests opened by bots");
    const scorecard = (issues: string) => `## EntelligenceAI PR Summary\nAdds a feature.\n\n---\n\n## Review Scorecard\n\n| Dimension | Rating | Basis |\n|---|---|---|\n| **Code Quality** | ●●●○○ **3/5** — Needs Work | 1 significant finding(s) |\n| **Merge Confidence** | ●●○○○ **2/5** — Changes Needed | code quality 3/5 × High blast radius |\n\n${issues}`;
    expect(parseBotBody(scorecard('**Issues found:**\n- **Significant** `docs/user-api.md` — Keep guidance on the supported surface\n- **Unresolved** `.github/workflows/ci.yml` — Make the checks required *(unresolved from an earlier review)*\n- *…plus 2 more, posted as inline comment(s)*\n\nFix before merge.'), 'entelligence')).toMatchObject({ clean: false, count: 4, score: 2 });
    expect(parseBotBody(scorecard('Ready to merge; code quality rated Excellent (5/5): the review found nothing to flag.\n\n**Key Findings:**\n- No critical or significant issues found'), 'entelligence')).toMatchObject({ clean: true, count: 0, score: 2 });
    // ...and as the page reads it: list items on their own lines with blank lines between, no bullets.
    expect(parseBotBody(scorecard('**Issues found:**\n\n**Significant** `docs/user-api.md` — Keep guidance on the supported surface\n\n**Unresolved** `.github/workflows/ci.yml` — Make the checks required *(unresolved from an earlier review)*\n\n*…plus 2 more, posted as inline comment(s)*\n\nFix before merge.'), 'entelligence')).toMatchObject({ clean: false, count: 4, score: 2 });
    // A stated verdict with no count or score is still a review: a conversational bot's "needs a human" is not chat.
    const human = parseBotBody("Hey - I've reviewed your changes and they look great!\n\n### Sourcery assessment\n\n**Needs a human reviewer.**", 'sourcery');
    expect(human.verdict).toBe('needs-human');
    expect(isReviewShaped(human)).toBe(true);
    expect(isReviewShaped(parseBotBody("## Reviewer's Guide\nThis PR preserves alignment.", 'sourcery'))).toBe(false);
    expect(verdictsFrom([], [{ author: 'macroscopeapp[bot]', body: '#### Approvability\n**Verdict:** Needs Human Approval\n\nMacroscope\'s review found this PR requires human approval.', anchor: 'issuecomment-3' }], 'aaa')[0]).toMatchObject({ id: 'macroscope', verdict: 'findings', sourceId: 'issuecomment-3' });
    expect(refusalReason('**Automatic Review Skipped**\n\nThis PR changes **132 files**, above the **100-file** limit for automatic reviews. Trigger a full review by commenting:\n```\n@entelligence review\n```')).toBe('This PR changes 132 files, above the 100-file limit for automatic reviews');
    expect(isStatusLineComment('Starting fresh pr review. This may take a few minutes')).toBe(true);
    // CodeRabbit's pass over this block: words that happen to be a bot's, a budget, a merge condition, a negation.
    expect(refusalReason('The cubic interpolation worker cannot run on the GPU path. Found 2 issues.')).toBeNull();
    expect(refusalReason('The import job exhausted its daily budget before the last page. Found 2 issues.')).toBeNull();
    expect(isStatusLineComment('Reviewing PR #396 revealed 2 bugs in the retry loop.')).toBe(false);
    // ...and the checklist as the page reads it: no checkbox marks, one item per line, however long it runs.
    expect(isStatusLineComment(`Reviewing PR #396\n\nGather context\n\nRead AGENTS.md\n\nReview diff (oidata, likelihood, plotting, docs, tests)\n\nCheck the fixtures under tests/ against the new loader and the two notebooks that import it\n\nRun the unit tests and the notebook smoke test\n\nPost inline findings and submit the verdict`)).toBe(true);
    expect(parseBotBody('## Review Summary\nThe PR is ready to merge after the failing check is fixed.', 'amazon-q').clean).toBe(false);
    expect(parseBotBody('## Review Summary\nThe PR is ready to merge once the snapshot is updated.', 'amazon-q').clean).toBe(false);
    const approvedNoHuman = parseBotBody('#### Approvability\n**Verdict:** Approved at `2a60be7`\n\nThis does not need human approval: the change is a test-only fix.', 'macroscope');
    expect(approvedNoHuman.clean).toBe(true);
    expect(approvedNoHuman.verdict).toBeUndefined();
    expect(parseBotBody('They look great, but this not only needs human approval; it also needs a security signoff.', 'sourcery')).toMatchObject({ clean: false, verdict: 'needs-human' });
    // The Autofix sibling aside, each bot's check is its own.
    expect(verdictsFrom([{ name: 'Claude Code Review', status: 'completed', conclusion: 'neutral', sha: 'aaa' }], [], 'aaa')[0]).toMatchObject({ id: 'claude', verdict: 'clean' });
    expect(verdictsFrom([{ name: 'Sourcery review', status: 'completed', conclusion: 'skipped', sha: 'aaa' }], [], 'aaa')[0]).toMatchObject({ id: 'sourcery', verdict: 'failed', reason: 'Check skipped' });
  });

  it('lets a green check speak for a bot whose only comment says it started', () => {
    for (const body of ['Starting Devin Review.', 'Bugbot is reviewing your changes…', 'Review in progress', "I'm looking into this now and will comment when done."]) {
      expect(isStatusLineComment(body), body).toBe(true);
    }
    for (const body of ['Found 2 issues', 'Bugbot reviewed your changes and found no new issues!', 'Starting from line 12, the loop never exits.']) {
      expect(isStatusLineComment(body), body).toBe(false);
    }
    // Bugbot: a run that found something, then a run that found nothing. The latest word wins, and the earlier
    // run's count does not ride along on a clean verdict.
    const bugbot = verdictsFrom(
      [],
      [
        { author: 'cursor[bot]', body: 'Cursor Bugbot has reviewed your changes and found 1 potential issue.', anchor: 'issuecomment-1' },
        { author: 'cursor[bot]', body: '✅ Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2' },
      ],
      'aaa',
    );
    expect(bugbot[0]).toMatchObject({ id: 'bugbot', verdict: 'clean', sourceId: 'issuecomment-2' });
    expect(bugbot[0]?.count).toBeUndefined();
    // Devin: says it is looking, then says nothing more when all is well; the completed check is the verdict.
    const devin = verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }], 'aaa');
    expect(devin[0]).toMatchObject({ id: 'devin', verdict: 'clean', sourceId: 'issuecomment-7' });
    // No check to go by: the bot is still running as far as anyone can tell.
    expect(verdictsFrom([], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }], 'aaa')[0]?.verdict).toBe('running');
    // A later comment with findings still counts.
    const found = verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }, { author: 'devin-ai-integration[bot]', body: 'Found 3 issues in this change.', anchor: 'issuecomment-8' }], 'aaa');
    expect(found[0]).toMatchObject({ verdict: 'findings', count: 3, sourceId: 'issuecomment-8' });
    // Findings, then a new push and "Starting" again, then a green check and silence: the latest run found nothing.
    const rerun = verdictsFrom(
      [{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'bbb' }],
      [
        { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' },
        { author: 'devin-ai-integration[bot]', body: 'Devin Review found 1 potential issue.', anchor: 'pullrequestreview-1' },
        { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-9' },
      ],
      'bbb',
    );
    expect(rerun[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-9' });
    expect(rerun[0]?.count).toBeUndefined();
    // The same with the check still going: running.
    expect(verdictsFrom([{ name: 'Devin Review', status: 'in_progress', conclusion: null, sha: 'bbb' }], [{ author: 'devin-ai-integration[bot]', body: 'Found 1 issue.', anchor: 'a' }, { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'b' }], 'bbb')[0]?.verdict).toBe('running');
  });

  it('judges a dated commit status against the run it answers, and an undated one as the run\'s', () => {
    // mint#12256: Devin reviewed on Oct 13 (a green "Devin Review" commit status, two threads, since resolved),
    // "/devin review" and "Starting Devin Review." again on Oct 18. Devin posts nothing when it finds nothing, so
    // the status, back to green, is the clean run — and on the page it carries no time, so it is taken as such.
    const t = (iso: string): string => new Date(iso).toISOString();
    const green = { name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'head' };
    const comments = [
      { author: 'lucaspunz', body: '/devin review', anchor: 'issuecomment-1', createdAt: t('2026-10-13T21:10:16Z') },
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-2', createdAt: t('2026-10-13T21:10:21Z') },
      { author: 'devin-ai-integration[bot]', body: 'Devin Review found 2 potential issues.', anchor: 'pullrequestreview-1', createdAt: t('2026-10-13T21:12:49Z') },
      { author: 'devin-ai-integration[bot]', body: 'Thread one.', anchor: 'discussion_r1', isReviewComment: true, resolved: true, createdAt: t('2026-10-13T21:12:50Z') },
      { author: 'devin-ai-integration[bot]', body: 'Thread two.', anchor: 'discussion_r2', isReviewComment: true, resolved: true, createdAt: t('2026-10-13T21:12:51Z') },
      { author: 'brandonmcconnell', body: '/devin review', anchor: 'issuecomment-3', createdAt: t('2026-10-18T10:43:26Z') },
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-4', createdAt: t('2026-10-18T10:43:30Z') },
    ];
    const soon = Date.parse('2026-10-18T10:47:00Z');
    expect(verdictsFrom([green], comments, 'head', [], soon)[0]).toMatchObject({ id: 'devin', verdict: 'clean', sourceId: 'issuecomment-4' });
    // The Action reads a status's `createdAt`: set after the request, it is this run's, clean.
    expect(verdictsFrom([{ ...green, completedAt: t('2026-10-18T10:44:40Z') }], comments, 'head', [], soon)[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-4' });
    // Set before it: the earlier run's, so the new run is still running.
    expect(verdictsFrom([{ ...green, completedAt: t('2026-10-13T21:13:00Z') }], comments, 'head', [], soon)[0]?.verdict).toBe('running');
    // A status pending since the request is the run under way.
    expect(verdictsFrom([{ ...green, status: 'in_progress', conclusion: null, startedAt: t('2026-10-18T10:43:31Z') }], comments, 'head', [], soon)[0]?.verdict).toBe('running');
    // An earlier status, and the line aged with no report: the earlier run stands whole, its two threads resolved.
    const later = soon + 60 * 60_000;
    expect(verdictsFrom([{ ...green, completedAt: t('2026-10-13T21:13:00Z') }], comments, 'head', [], later)[0]).toMatchObject({ verdict: 'findings', count: 0 });
  });

  it('reads a run started from CI, with nothing said in the thread, from its check alone', () => {
    const running = [
      { name: 'Cursor Bugbot', status: 'in_progress', conclusion: null, sha: 'bbb' },
      { name: 'Greptile Review', status: 'queued', conclusion: null, sha: 'bbb' },
    ];
    // A bot run by the repository's CI (or from its own site) posts nothing until it is done: its check is the
    // only sign. With no comments at all, both are running.
    expect(verdictsFrom(running, [], 'bbb').map((bot) => `${bot.id}:${bot.verdict}`).sort()).toEqual(['bugbot:running', 'greptile:running']);
    // With the summary of an earlier run in the thread, the running check is the current run and wins; the
    // earlier summary stays as what the chip opens.
    const earlier = [
      { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 2 issues.', anchor: 'issuecomment-1' },
      { author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2' },
    ];
    const verdicts = verdictsFrom(running, earlier, 'bbb');
    expect(verdicts.find((bot) => bot.id === 'greptile')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-1', checkName: 'Greptile Review' });
    expect(verdicts.find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-2', checkName: 'Cursor Bugbot' });
    // Once the check completes, the comments say what the run found.
    const done = running.map((check) => ({ ...check, status: 'completed', conclusion: 'success' }));
    expect(verdictsFrom(done, earlier, 'bbb').map((bot) => `${bot.id}:${bot.verdict}`).sort()).toEqual(['bugbot:clean', 'greptile:findings']);
  });

  it('tells a finished run\'s report from the summary of the run before by the check\'s start', () => {
    const now = Date.UTC(2026, 9, 7, 22, 10);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    const byId = (list: readonly DerivedBotVerdict[], id: string): DerivedBotVerdict | undefined => list.find((bot) => bot.id === id);
    // Greptile reviewed an hour ago (4/5, 2 issues) and Bugbot was clean; both checks ran again from CI, starting
    // five minutes ago, and finished a moment ago. Nothing new in the thread yet.
    const greptileSummary = { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 2 issues.', anchor: 'issuecomment-1', createdAt: at(60) };
    const bugbotSummary = { author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2', createdAt: at(60) };
    const earlier = [greptileSummary, bugbotSummary];
    const greptileCheck = { name: 'Greptile Review', status: 'completed', conclusion: 'success', sha: 'bbb', startedAt: at(5), completedAt: at(0.2) };
    const bugbotCheck = { name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha: 'bbb', startedAt: at(5), completedAt: at(0.2) };
    const finished = [greptileCheck, bugbotCheck];
    // The old summaries are the run before: the report is awaited, the chip keeps running (and the old summary to open).
    const awaiting = verdictsFrom(finished, earlier, 'bbb', [], now);
    expect(byId(awaiting, 'greptile')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-1', checkName: 'Greptile Review', runJudged: true });
    expect(byId(awaiting, 'greptile')?.score).toBeUndefined();
    expect(byId(awaiting, 'bugbot')).toMatchObject({ verdict: 'running', runJudged: true });
    // Greptile reports by rewriting its summary; Bugbot by a new comment. A word newer than the start is the report.
    const reported = [
      { ...greptileSummary, body: 'Confidence Score: 5/5\nNo issues found.', editedAt: at(0.1) },
      bugbotSummary,
      { author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found 1 issue.', anchor: 'issuecomment-3', createdAt: at(0.1) },
    ];
    const settled = verdictsFrom(finished, reported, 'bbb', [], now);
    expect(byId(settled, 'greptile')).toMatchObject({ verdict: 'clean', score: 5, runJudged: true });
    expect(byId(settled, 'bugbot')).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'issuecomment-3', runJudged: true });
    // A bot that reports through CI alone never posts: past the grace, its check's conclusion is the whole verdict.
    const later = now + REPORT_GRACE_MS + 1000;
    const quiet = verdictsFrom(finished, earlier, 'bbb', [], later);
    expect(byId(quiet, 'greptile')).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-1', runJudged: true });
    expect(byId(quiet, 'greptile')?.score).toBeUndefined();
    expect(byId(quiet, 'greptile')?.count).toBeUndefined();
    const failedRun = verdictsFrom([{ ...bugbotCheck, conclusion: 'failure' }], earlier, 'bbb', [], later);
    expect(byId(failedRun, 'bugbot')?.verdict).toBe('failed');
    // A coding agent's reply during the run is conversation, not its review: the report is still awaited.
    const chat = [
      { author: 'replicas-dev[bot]', body: 'Found 2 issues.', anchor: 'pullrequestreview-7', createdAt: at(60) },
      { author: 'replicas-dev[bot]', body: 'Sure, I will look at the migration too.', anchor: 'issuecomment-8', createdAt: at(1) },
    ];
    const replicasCheck = { name: 'Replicas', status: 'completed', conclusion: 'success', sha: 'bbb', startedAt: at(5), completedAt: at(0.2) };
    expect(byId(verdictsFrom([replicasCheck], chat, 'bbb', [], now), 'replicas')).toMatchObject({ verdict: 'running', runJudged: true });
    // A finished check whose start nobody saw cannot be judged: the comments decide as before, and say so.
    const undated = finished.map(({ startedAt: _s, completedAt: _c, ...check }) => check);
    expect(byId(verdictsFrom(undated, earlier, 'bbb', [], now), 'greptile')).toMatchObject({ verdict: 'findings', score: 4 });
    expect(byId(verdictsFrom(undated, earlier, 'bbb', [], now), 'greptile')?.runJudged).toBeUndefined();
  });

  it('starts a run when a person asks a bot to', () => {
    const now = Date.UTC(2026, 8, 29, 19, 0);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    const before = [
      { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nNo issues found.', anchor: 'issuecomment-1', createdAt: at(60) },
      { author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2', createdAt: at(60) },
    ];
    const asked = [...before, { author: 'brandonmcconnell', body: '@greptileai', anchor: 'issuecomment-3', createdAt: at(1) }];
    const byId = (list: readonly DerivedBotVerdict[], id: string): DerivedBotVerdict | undefined => list.find((bot) => bot.id === id);
    // Greptile was asked a minute ago and has not spoken: running, from the request. Bugbot was not asked.
    expect(byId(verdictsFrom([], asked, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-3', login: 'greptile-apps[bot]' });
    expect(byId(verdictsFrom([], asked, 'aaa', [], now), 'bugbot')?.verdict).toBe('clean');
    // Its answer ends the run.
    const answered = [...asked, { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 1 issue.', anchor: 'issuecomment-4', createdAt: at(0) }];
    expect(byId(verdictsFrom([], answered, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'findings', score: 4, sourceId: 'issuecomment-4' });
    // Several bots in one comment; a request that aged with no answer is a run that never reported.
    expect(verdictsFrom([], [...before, { author: 'someone', body: 'bugbot run @greptileai', anchor: 'c', createdAt: at(1) }], 'aaa', [], now).map((bot) => `${bot.id}:${bot.verdict}`).sort()).toEqual(['bugbot:running', 'greptile:running']);
    expect(byId(verdictsFrom([], [...before, { author: 'someone', body: '@greptileai', anchor: 'c', createdAt: at(120) }], 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-1' });
    expect(botsTriggeredBy('/devin review').map((bot) => bot.id)).toEqual(['devin']);
    // Greptile answers a re-run by rewriting its summary in place ("Reviews (2)", a new score), posting nothing new:
    // the summary edited after the request is the run's report, with the verdict its words now say.
    const request = { author: 'brandonmcconnell', body: '@greptileai', anchor: 'issuecomment-3', createdAt: at(1) };
    const rewritten = [{ author: 'greptile-apps[bot]', body: 'Confidence Score: 3/5\nFound 2 issues.\nReviews (2)', anchor: 'issuecomment-1', createdAt: at(60), editedAt: at(0.5) }, request];
    expect(byId(verdictsFrom([], rewritten, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'findings', score: 3, count: 2, sourceId: 'issuecomment-1' });
    // Edited before the request (the first review's own touch-up): still running.
    const touchedUp = [{ author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nNo issues found.', anchor: 'issuecomment-1', createdAt: at(60), editedAt: at(59) }, request];
    expect(byId(verdictsFrom([], touchedUp, 'aaa', [], now), 'greptile')?.verdict).toBe('running');
    // Greptile reacts (👍) the moment it takes a trigger. A trigger it has not reacted to after the grace was never
    // seen: the earlier verdict stands and the reader can ask again. Within the grace it is given the benefit.
    const summary = { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nNo issues found.', anchor: 'issuecomment-1', createdAt: at(60) };
    const ignored = { author: 'brandonmcconnell', body: '@greptileai', anchor: 'issuecomment-3', createdAt: at(5) };
    expect(byId(verdictsFrom([], [summary, ignored], 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-1' });
    expect(byId(verdictsFrom([], [summary, { ...ignored, reactedBy: ['greptile-apps[bot]'] }], 'aaa', [], now), 'greptile')?.verdict).toBe('running');
    expect(byId(verdictsFrom([], [summary, { ...ignored, createdAt: at(1) }], 'aaa', [], now), 'greptile')?.verdict).toBe('running');
    // Bugbot starts silently: its trigger counts until it ages, reaction or not.
    expect(byId(verdictsFrom([], [{ author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2', createdAt: at(60) }, { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-3', createdAt: at(5) }], 'aaa', [], now), 'bugbot')?.verdict).toBe('running');
    // A bot asking another bot: Cursor's cloud agents post "@greptileai" as `cursor[bot]` (Bugbot's own login).
    // Greptile is asked just the same; Bugbot is not asking itself to run.
    const byAgent = { author: 'cursor[bot]', body: '@greptileai', anchor: 'issuecomment-3', createdAt: at(1), reactedBy: ['greptile-apps[bot]'] };
    expect(byId(verdictsFrom([], [...before, byAgent], 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-3' });
    expect(byId(verdictsFrom([], [...before, byAgent], 'aaa', [], now), 'bugbot')?.verdict).toBe('clean');
    expect(byId(verdictsFrom([], [...before, { ...byAgent, body: 'bugbot run' }], 'aaa', [], now), 'bugbot')?.verdict).toBe('clean');
    // ...and the summary Greptile rewrote after that request is the run's report (geld#31: resolved threads before
    // the request, "5/5" edited into the summary after it, nothing new posted).
    const agentRun = [{ author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nNo issues found.\nReviews (3)', anchor: 'issuecomment-1', createdAt: at(60), editedAt: at(0.5) }, { author: 'greptile-apps[bot]', body: 'Unused import', anchor: 'discussion_r1', resolved: true, createdAt: at(30) }, byAgent];
    expect(byId(verdictsFrom([], agentRun, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'clean', score: 5, sourceId: 'issuecomment-1' });
  });

  it('weighs the earlier run\u2019s threads again when a request for the bot went unanswered', () => {
    const now = Date.UTC(2026, 9, 13, 19, 0);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    // mint#12803: Bugbot's review ("found 1 potential issue") and its one thread, resolved since; then "bugbot run"
    // an hour ago that Bugbot never answered (no check on the repository). The run that stands is the earlier
    // one, threads and all: resolved, not "1 issue".
    const summary: BotComment = { author: 'cursor[bot]', body: 'Cursor Bugbot has reviewed your changes using default effort and found 1 potential issue.', anchor: 'pullrequestreview-1', createdAt: at(1300) };
    const thread: BotComment = { author: 'cursor[bot]', body: 'Remote schema fetch type mismatch', anchor: 'discussion_r1', resolved: true, createdAt: at(1300) };
    const request: BotComment = { author: 'brandonmcconnell', body: '@greptileai bugbot run', anchor: 'issuecomment-3', createdAt: at(70) };
    const bugbot = (comments: readonly BotComment[], when = now): DerivedBotVerdict | undefined => verdictsFrom([], comments, 'aaa', [], when).find((bot) => bot.id === 'bugbot');
    expect(bugbot([summary, thread, request])).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r1' });
    // Still open: the finding stands as before the request.
    expect(bugbot([summary, { ...thread, resolved: false }, request])).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r1' });
    // A request a minute old: running, as before.
    expect(bugbot([summary, thread, { ...request, createdAt: at(1) }])?.verdict).toBe('running');
    // A bot that only ever posted threads (no summary, no check): the same, not "failed" for the silence.
    expect(bugbot([thread, request])).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r1' });
    expect(bugbot([{ ...thread, resolved: false }, request])).toMatchObject({ verdict: 'findings', count: 1 });
    // While the timeline is still being read the answer may not have loaded: the earlier threads are not final
    // yet (a bot with nothing else reads loading, as an unanswered request does on a partial timeline).
    expect(verdictsFrom([], [thread, request], 'aaa', [], now, { partial: true }).find((bot) => bot.id === 'bugbot')?.verdict).toBe('loading');
    expect(verdictsFrom([], [summary, { ...thread, resolved: false }, request], 'aaa', [], now, { partial: true }).find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'pullrequestreview-1' });
    // A check speaks for the requested run only when it began after the request. The earlier run's check, green,
    // does not turn an open finding clean while the request goes unanswered: running, then the earlier run again.
    const earlierCheck = { name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha: 'aaa', startedAt: at(1310), completedAt: at(1290) };
    expect(verdictsFrom([earlierCheck], [summary, { ...thread, resolved: false }, request], 'aaa', [], now).find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 1 });
    expect(verdictsFrom([earlierCheck], [summary, { ...thread, resolved: false }, { ...request, createdAt: at(1) }], 'aaa', [], now).find((bot) => bot.id === 'bugbot')?.verdict).toBe('running');
    // One that began after the request is its answer.
    const answerCheck = { ...earlierCheck, startedAt: at(60), completedAt: at(50) };
    expect(verdictsFrom([answerCheck], [summary, { ...thread, resolved: false }, request], 'aaa', [], now).find((bot) => bot.id === 'bugbot')?.verdict).toBe('clean');
    // Two checks for one bot, the later with no times of its own: its verdict is the one kept, so the times kept
    // are its (none) — not the earlier check's, which would read the later verdict as the earlier run's.
    const { startedAt: _started, completedAt: _completed, ...undatedCheck } = earlierCheck;
    expect(verdictsFrom([earlierCheck, undatedCheck], [summary, { ...thread, resolved: false }, request], 'aaa', [], now).find((bot) => bot.id === 'bugbot')?.verdict).toBe('clean');
    // A commit status has one moment, which the Action reads: a finish with no start stands in for it, before the
    // request the earlier run's, after it the answer.
    expect(verdictsFrom([{ ...undatedCheck, completedAt: at(1290) }], [summary, { ...thread, resolved: false }, request], 'aaa', [], now).find((bot) => bot.id === 'bugbot')).toMatchObject({ verdict: 'findings', count: 1 });
    expect(verdictsFrom([{ ...undatedCheck, completedAt: at(50) }], [summary, { ...thread, resolved: false }, request], 'aaa', [], now).find((bot) => bot.id === 'bugbot')?.verdict).toBe('clean');
  });

  it('has no word on a request that aged unanswered on a merged pull request', () => {
    // mint#12962: "bugbot run" in a request comment, Devin and Greptile answered, Bugbot never did, and the pull
    // request was merged — GitHub shows none of its checks any more, so Bugbot's silence is no failure.
    const now = Date.UTC(2026, 9, 15, 0, 0);
    const request: BotComment = { author: 'brandonmcconnell', body: '/devin review\nbugbot run\n@greptileai', anchor: 'issuecomment-1', createdAt: new Date(now - 2 * 3_600_000).toISOString() };
    const bugbot = (checks: readonly RawCheckRun[], options: VerdictOptions): DerivedBotVerdict | undefined => verdictsFrom(checks, [request], 'aaa', [], now, options).find((bot) => bot.id === 'bugbot');
    expect(bugbot([], { closed: true })).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-1' });
    // Open, the same silence is no word either: Bugbot acknowledges nothing, so nothing says it saw the request —
    // mint#12998, a draft (which Bugbot skips by default), six "bugbot run" unanswered, no check, read red. Still
    // reading, it is loading.
    expect(bugbot([], {})?.verdict).toBe('unknown');
    expect(bugbot([], { closed: true, partial: true })?.verdict).toBe('loading');
    // A check that did run on the closed pull request still speaks for it.
    expect(bugbot([{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha: 'aaa', startedAt: new Date(now - 3_600_000).toISOString() }], { closed: true })?.verdict).toBe('clean');
  });

  it('does not keep a bot running on a status line that aged with nothing after it', () => {
    const t = (minutesAgo: number): string => new Date(Date.UTC(2026, 8, 25, 5, 40) - minutesAgo * 60_000).toISOString();
    const now = Date.UTC(2026, 8, 25, 5, 40) + 4 * 24 * 3_600_000;
    // Devin on mintlify/mint#11955: starting, a clean review, starting again on a push, then silence for days
    // and no check run on the repository. The clean review stands; "running" for four days does not.
    const devin = [
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-1', createdAt: t(5) },
      { author: 'devin-ai-integration[bot]', body: '✅ Devin Review: No Issues Found\nDevin Review analyzed this PR and found no bugs or issues to report.', anchor: 'pullrequestreview-1', createdAt: t(4) },
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-2', createdAt: t(0) },
    ];
    expect(verdictsFrom([], devin, 'aaa', [], now)[0]).toMatchObject({ verdict: 'clean', sourceId: 'pullrequestreview-1' });
    // The same lines ten minutes later: still running.
    expect(verdictsFrom([], devin, 'aaa', [], Date.UTC(2026, 8, 25, 5, 50))[0]).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-2' });
    // A bot that only ever said "starting", long ago, and nothing on the page says how it went: no word, not a
    // failure (geld#57: CodeRabbit's "Currently processing…" left standing read as failed, red).
    expect(verdictsFrom([], devin.slice(2), 'aaa', [], now)[0]).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-2' });
    // A person's request the bot never acknowledged or answered is no word either (Devin acknowledges nothing).
    expect(verdictsFrom([], [{ author: 'brandonmcconnell', body: '/devin review', anchor: 'issuecomment-9', createdAt: t(0) }], 'aaa', [], now)[0]).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-9' });
    // A check run says how the run ended, however old the line.
    expect(verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], devin.slice(2), 'aaa', [], now)[0]?.verdict).toBe('clean');
    // Without a timestamp nothing ages.
    expect(verdictsFrom([], devin.slice(2).map(({ createdAt: _at, ...rest }) => rest), 'aaa', [], now)[0]?.verdict).toBe('running');
  });

  it('weighs a bot\'s review threads by whether they are still open', () => {
    const summary = { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 2 issues.', anchor: 'pullrequestreview-1' };
    const open = [
      summary,
      { author: 'greptile-apps[bot]', body: 'Distinct cookie name dropped', anchor: 'discussion_r1', resolved: false },
      { author: 'greptile-apps[bot]', body: 'Copied paths use wrong encoding', anchor: 'discussion_r2', resolved: true },
    ];
    // One thread still open: that is the outstanding finding, and where the chip points.
    expect(verdictsFrom([], open, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r1' });
    // Every thread resolved: nothing outstanding, whatever the wording of the threads themselves.
    const resolved = open.map((comment) => ('resolved' in comment ? { ...comment, resolved: true } : comment));
    // ...and the run's score stays with it: the score is what Greptile is read for.
    expect(verdictsFrom([], resolved, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 0, score: 4, sourceId: 'discussion_r2' });
    expect(verdictsFrom([], open, 'aaa')[0]?.score).toBe(4);
    // A check that passed does not make resolved findings a run that found nothing: still "resolved", score kept.
    expect(verdictsFrom([{ name: 'Greptile', status: 'completed', conclusion: 'success', sha: 'aaa' }], resolved, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 0, score: 4 });
    // One that failed, or is still running, says so.
    expect(verdictsFrom([{ name: 'Greptile', status: 'completed', conclusion: 'failure', sha: 'aaa' }], resolved, 'aaa')[0]?.verdict).toBe('failed');
    // A clean summary after resolved threads is the latest word; threads after a summary belong to that summary's run.
    const later = [...resolved, { author: 'greptile-apps[bot]', body: 'No findings outside the diff remain.', anchor: 'issuecomment-9' }];
    expect(verdictsFrom([], later, 'aaa')[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-9' });
    const rerun = [...later, { author: 'greptile-apps[bot]', body: 'Escaped schema refs fail', anchor: 'discussion_r3', resolved: false }];
    expect(verdictsFrom([], rerun, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r3' });
  });

  it('reads a summary rewritten well after a resolved thread run as the latest word', () => {
    const now = Date.UTC(2026, 9, 8, 18, 0);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    // geld#31: Greptile's summary (edited to "5/5" at 17:29) and its two rounds of threads (17:08, 17:22), every one
    // resolved. The rewrite came seven minutes after the last thread with nothing new posted: a re-run that found
    // nothing. The chip says 5/5 and opens the summary, not "resolved" at the last thread.
    const summary = { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nThe PR appears safe to merge; no actionable issues were found.\nReviews (3)', anchor: 'issuecomment-1', createdAt: at(52) };
    const first = { author: 'greptile-apps[bot]', body: 'Requests reuse another PR\u2019s reviewers', anchor: 'discussion_r1', resolved: true, createdAt: at(52) };
    const second = { author: 'greptile-apps[bot]', body: 'No reviewer post without the pending set', anchor: 'discussion_r2', resolved: true, createdAt: at(38) };
    const threads = [first, second];
    expect(verdictsFrom([], [{ ...summary, editedAt: at(31) }, ...threads], 'aaa', [], now)[0]).toMatchObject({ verdict: 'clean', score: 5, sourceId: 'issuecomment-1' });
    // Edited while the threads landed (the run's own touch-up): the threads are the run, resolved.
    expect(verdictsFrom([], [{ ...summary, editedAt: at(37.5) }, ...threads], 'aaa', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r2' });
    // Never edited: as before.
    expect(verdictsFrom([], [summary, ...threads], 'aaa', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r2' });
    // A thread still open is outstanding whatever the summary was rewritten to say since.
    const open = [{ ...summary, editedAt: at(31) }, first, { ...second, resolved: false }];
    expect(verdictsFrom([], open, 'aaa', [], now)[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r2' });
    // The rewrite must be the verdict's own summary's: an older summary of the bot's edited late says nothing about
    // the newer one the verdict was read from, so the resolved threads stay the last word.
    const older = { author: 'greptile-apps[bot]', body: 'Confidence Score: 2/5\nFound 3 issues.', anchor: 'issuecomment-0', createdAt: at(90), editedAt: at(31) };
    const newer = { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 2 issues.', anchor: 'issuecomment-1', createdAt: at(52) };
    expect(verdictsFrom([], [older, newer, ...threads], 'aaa', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, sourceId: 'discussion_r2' });
  });

  it('counts only review-shaped comments from a conversational agent', () => {
    const replies = [
      { author: 'replicas-connector[bot]', body: '@greptile-apps[bot] Request accepted: [Open workspace](https://app.replicas.dev/w/1). Your message was accepted and Codex will start automatically when the workspace is ready.', anchor: 'c1' },
      { author: 'replicas-connector[bot]', body: 'Thank you. That review covered the previous head. 9ae3272 now also requires HTTPS for remote artifact endpoints.', anchor: 'c2' },
    ];
    // Replies to another bot are not a review: no verdict from them alone (the first is a status line, the second a reply).
    expect(verdictsFrom([], replies, 'aaa').map((bot) => bot.verdict)).toEqual(['running']);
    const scored = verdictsFrom([], [...replies, { author: 'replicas-connector[bot]', body: 'Code Review\n\nReview score: 4/5\n\nFound 1 issue: the retry loop never backs off.', anchor: 'c3' }], 'aaa');
    expect(scored[0]).toMatchObject({ id: 'replicas', verdict: 'findings', score: 4, count: 1, sourceId: 'c3' });
    expect(botByTrigger('/replicas run code-review')?.id).toBe('replicas');
  });

  it('knows Capy by its App login and its review trigger', () => {
    expect(resolveBotId('capy-ai[bot]')).toBe('capy');
    expect(botByTrigger('@capy review')?.id).toBe('capy');
    expect(botTitle('capy', 'capy-ai[bot]')).toBe('Capy');
  });

  it('drops unknown ids from model output', () => {
    const parsed = parseConsolidateOutput(
      JSON.stringify({ items: [{ id: 'keep', title: 'Hello' }, { id: 'nope', title: 'X' }] }),
      new Set(['keep']),
    );
    expect(parsed).toEqual({ ok: true, value: [{ id: 'keep', title: 'Hello' }] });
  });

  it('rejects non-JSON model output', () => {
    expect(parseConsolidateOutput('not json', new Set(['a'])).ok).toBe(false);
  });
});

describe('a bot that refuses to run', () => {
  const skipping = 'Skipping Bugbot: Bugbot is disabled for this repository. Visit the [Bugbot dashboard](https://www.cursor.com/dashboard/bugbot) to update your settings.';

  it('reads the refusal and its reason, without the bot naming itself', () => {
    expect(refusalReason(skipping)).toBe('Bugbot is disabled for this repository');
    expect(refusalReason('Greptile is not enabled for this repo. Enable it in the dashboard.')).toBe('Greptile is not enabled for this repo');
    expect(refusalReason('You have no credits remaining. Upgrade your plan to continue.')).toBe('You have no credits remaining');
    expect(refusalReason('Could not access the repository: permission denied.')).toBe('Could not access the repository: permission denied');
    // Notices headed by their reason over a long explanation (Bugbot, raw and as the page reads the heading), and
    // Codex's usage-limit line: all skips of the run, none of them findings.
    expect(refusalReason('<h3>Bugbot couldn\'t run - usage limit reached</h3>\nBugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit. An admin can raise the limit or enable on-demand usage in the dashboard; then re-run Bugbot with `bugbot run`. Learn more about [usage](https://cursor.com/docs) and [Bugbot billing](https://cursor.com/docs/bugbot).')).toBe("Bugbot couldn't run - usage limit reached");
    expect(refusalReason("Bugbot couldn't run - usage limit reached\nBugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit.")).toBe("Bugbot couldn't run - usage limit reached");
    expect(refusalReason('<h3>Bugbot needs on-demand usage enabled</h3>\nBugbot uses usage-based billing for this team and requires on-demand usage to be enabled. A team admin can enable it in the dashboard, after which Bugbot runs on this pull request as usual; until then every run is skipped and this notice is posted again on each push to the branch so nobody is left waiting on a review that is not coming.')).toBe('Bugbot needs on-demand usage enabled');
    expect(refusalReason('Codex usage limits have been reached for code reviews. Please check with the admins of this repo to increase the limits by adding credits. Repo admins can do so in the Codex settings.')).toBe('Codex usage limits have been reached for code reviews');
    // A heading about the code, not the bot, is a finding's: no refusal.
    expect(refusalReason('<h3>Cannot run migrations on a fresh database</h3>\nThe new migration references a table created two migrations later, so `db migrate` fails from scratch while an existing database upgrades fine. Reorder the files or add the dependency.')).toBeNull();
    expect(refusalReason('### Config needs the flag enabled\nThe worker reads `FEATURE_X` but nothing in the deploy manifest sets it, so the branch below is dead in production.')).toBeNull();
    expect(refusalReason('<h3>Cannot run review tests on a fresh checkout</h3>\nThe fixtures under `test/review/` assume a seeded database, so the suite fails on a clean clone until `make seed` has run; add it to the test target.')).toBeNull();
    // A finding that mentions this pull request is about the code, not the bot's run.
    expect(refusalReason('The worker added in this PR cannot access `session` because the caller drops it before the handoff.')).toBeNull();
    // A soft-wrapped Markdown sentence is one sentence; only a blank line or a heading ends one.
    expect(refusalReason('Bugbot is not\nenabled for this repository. Visit the dashboard to enable it.')).toBe('Bugbot is not enabled for this repository');
    expect(refusalReason('Skipping Bugbot: Bugbot is disabled\nfor this repository.\n\nVisit the [Bugbot dashboard](https://cursor.com/dashboard/bugbot) to update your settings.')).toBe('Bugbot is disabled for this repository');
    // A heading inside a blockquote ends its block too.
    expect(refusalReason('> ### Permission denied\n> Check the token and retry.')).toBe('Permission denied');
    expect(refusalReason('Permission denied:\n\nCheck the token and retry.')).toBe('Permission denied');
    // A run-failure heading about the code, with a usage word in it, is still a finding's; a usage heading needs no bot name.
    expect(refusalReason('<h3>Cannot run quota migrations on a fresh database</h3>\nThe quota table is created two migrations later, so `db migrate` fails from scratch.')).toBeNull();
    expect(refusalReason('<h3>Usage limit reached</h3>\nThis run hit the team\u2019s spend limit; an admin can raise it in the dashboard, after which reviews resume on the next push to this branch without any further action here.')).toBe('Usage limit reached');
    // The limit named the other way round.
    expect(refusalReason('Bugbot has reached its usage limit for this billing period.')).toBe('Bugbot has reached its usage limit for this billing period');
    expect(refusalReason('The usage limit was reached for code reviews; try again next month.')).toBe('The usage limit was reached for code reviews; try again next month');
    // A limit the code handles, not one the bot hit; a money word in the sentence is no subject for it.
    expect(refusalReason('The billing worker retries forever after the customer has reached their usage limit.')).toBeNull();
    expect(refusalReason('The billing job exceeded the retry limit and gave up.')).toBeNull();
    expect(refusalReason('Insufficient quota for this run; add credits to continue.')).toBe('Insufficient quota for this run; add credits to continue');
    // A finding headed "Permission denied:" keeps its explanation — a statement about the code is not advice.
    expect(refusalReason('Permission denied:\n\nThe new guard rejects every request because the role check is reversed.')).toBeNull();
    expect(refusalReason('Permission denied. The app must be installed for this organization.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. An administrator must grant access before retrying.')).toBe('Permission denied');
    expect(refusalReason('Billing is not configured. Please add a payment method.')).toBe('Billing is not configured');
    expect(refusalReason('Credits are unavailable for this run.')).toBe('Credits are unavailable for this run');
    // An obligation on the code is a finding; so is a money word followed by what the code does.
    expect(refusalReason('Permission denied. The guard should allow members but rejects every request.')).toBeNull();
    expect(refusalReason('Credits are unavailable because the new query excludes paid users.')).toBeNull();
    expect(refusalReason('Permission denied. The token must have the required scopes.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The GitHub app must be installed for this organization.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. These credentials must have the required scopes.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The newly generated token must have the required scopes.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The guard drops permissions on every request.')).toBeNull();
    expect(refusalReason('Permission denied. The token currently lacks the required scopes.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The repository is private.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The bot needs access to this repository.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The review needs read access to the repository.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. The new permissions now require an administrator for every read, breaking existing member access.')).toBeNull();
    expect(refusalReason('Permission denied. The guard rejects members because it checks the wrong permissions.')).toBeNull();
    expect(refusalReason('Billing is not configured for this integration. Please add a payment method.')).toBe('Billing is not configured for this integration');
    expect(refusalReason('Credits are unavailable until the next billing cycle.')).toBe('Credits are unavailable until the next billing cycle');
    // CodeRabbit's skip notice (geld#48), raw and as the page reads it: long (its run configuration follows), so the
    // reason is read before the length cap; the chip then says skipped, not findings.
    const crSkipRaw = '<!-- This is an auto-generated comment: skip review by coderabbit.ai -->\n\n> [!IMPORTANT]\n> ## Review skipped\n> \n> Auto reviews are disabled on base/target branches other than the default branch.\n> \n> Please check the settings in the CodeRabbit UI or the `.coderabbit.yaml` file in this repository. To trigger a single review, invoke the `@coderabbitai review` command.\n> \n> <details>\n> <summary><strong>⚙️ Run configuration</strong></summary>\n> - **Configuration used**: defaults\n> - **Review profile**: CHILL\n> - **Plan**: Advanced\n> - **Run ID**: `06f58674-6686-4766-b8d6-0ef253422b`\n> </details>\n> \n> You can disable this status message by setting the `reviews.review_status` to `false` in the CodeRabbit configuration file.';
    expect(refusalReason(crSkipRaw)).toBe('Auto reviews are disabled on base/target branches other than the default branch');
    const crSkipPage = 'Important\nReview skipped\nAuto reviews are disabled on base/target branches other than the default branch.\nPlease check the settings in the CodeRabbit UI or the .coderabbit.yaml file in this repository. To trigger a single review, invoke the @coderabbitai review command.\n⚙️ Run configuration\nConfiguration used: defaults\nReview profile: CHILL\nPlan: Advanced\nRun ID: 06f58674-6686-4766-b8d6-0ef253422b';
    expect(refusalReason(crSkipPage)).toBe('Auto reviews are disabled on base/target branches other than the default branch');
    expect(refusalReason('Important\nReview skipped\nReview was skipped as selected files did not have any reviewable changes.\n⛔ Files ignored due to path filters: 1\npnpm-lock.yaml is excluded by !**/pnpm-lock.yaml')).toBe('Review was skipped as selected files did not have any reviewable changes');
    const now = Date.UTC(2026, 9, 15, 0, 30);
    expect(verdictsFrom([], [{ author: 'coderabbitai[bot]', body: crSkipPage, anchor: 'issuecomment-1', createdAt: new Date(now - 3_600_000).toISOString() }], 'aaa', [], now)[0]).toMatchObject({ verdict: 'failed', reason: 'Auto reviews are disabled on base/target branches other than the default branch', sourceId: 'issuecomment-1' });
  });

  it('ends a run left under way by the bot giving up on it (geld#103)', () => {
    // A merge mid-run: CodeRabbit rewrote its summary into a failure notice over the last walkthrough, and its commit
    // status stayed "pending · Review in progress" for good.
    const failRaw =
      '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n\n> [!CAUTION]\n> ## Review failed\n> \n> The pull request is closed.\n\n<!-- end of auto-generated comment: failure by coderabbit.ai -->\n\n<!-- walkthrough_start -->\n\nNo actionable comments were generated in the recent review.\n\n<details><summary>Recent review info</summary>Run configuration</details>';
    const failPage = 'Caution\nReview failed\nThe pull request is closed.\nNo actionable comments were generated in the recent review.\nRecent review info\nRun configuration';
    expect(refusalReason(failRaw)).toBe('The pull request is closed');
    expect(refusalReason(failPage)).toBe('The pull request is closed');
    expect(refusalReason('Review failed login attempts are not rate limited, so the endpoint can be brute forced.')).toBeNull();
    const pending = { name: 'CodeRabbit', status: 'in_progress' as const, conclusion: null, sha: 'head' };
    const comments = [
      { author: 'coderabbitai[bot]', body: failPage, anchor: 'issuecomment-1', createdAt: '2026-10-26T20:42:12Z', editedAt: '2026-10-26T21:59:47Z' },
      { author: 'coderabbitai[bot]', body: 'Actionable comments posted: 1', anchor: 'pullrequestreview-1', createdAt: '2026-10-26T20:53:13Z' },
      { author: 'coderabbitai[bot]', body: 'Refit the box on scroll.', anchor: 'discussion_r1', createdAt: '2026-10-26T20:53:12Z', resolved: true },
    ];
    const now = Date.parse('2026-10-26T22:10:00Z');
    // Merged: the run cannot go on, and the last real review (its one finding, resolved) stands.
    // Its commit is not the refused check's (the run there was refused), and the comments do not say which it is: behind.
    expect(verdictsFrom([pending], comments, 'head', [], now, { closed: true })[0]).toMatchObject({ id: 'coderabbit', verdict: 'findings', count: 0, runJudged: true, reviewedSha: UNKNOWN_SHA });
    // Still open and the status carries no start: an old refusal must not end a run that may be new.
    expect(verdictsFrom([pending], comments, 'head', [], now)[0]?.verdict).toBe('running');
    // A known start: a refusal after it ends that run, one before it does not.
    expect(verdictsFrom([{ ...pending, startedAt: '2026-10-26T21:51:59Z' }], comments, 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, reviewedSha: UNKNOWN_SHA });
    expect(verdictsFrom([{ ...pending, startedAt: '2026-10-26T22:05:00Z' }], comments, 'head', [], now)[0]?.verdict).toBe('running');
    // A bot that never reviewed here reads skipped, with its reason.
    expect(verdictsFrom([pending], [comments[0]!], 'head', [], now, { closed: true })[0]).toMatchObject({ verdict: 'failed', reason: 'The pull request is closed', reviewedSha: 'head' });
  });

  it("reads CodeRabbit's answer to a command as no review (geld#68)", () => {
    const finishedRaw =
      '<!-- coderabbit-ai-generated:v1 -->\n\n<!-- This is an auto-generated reply by CodeRabbit -->\n<details>\n<summary>✅ Action performed</summary>\n<dl>\n<dd>\n\nReview finished.\n\n> Note: CodeRabbit is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.\n\n</dd>\n</dl>\n</details>';
    const finishedPage = '✅ Action performed\nReview finished.\nNote: CodeRabbit is an incremental review system and does not re-review already reviewed commits. This command is applicable only when automatic reviews are paused.';
    const triggeredPage = '✅ Action performed\nReview triggered.\nNote: CodeRabbit is an incremental review system and does not re-review already reviewed commits.';
    expect(commandReply(finishedRaw)).toBe('done');
    expect(commandReply(finishedPage)).toBe('done');
    expect(commandReply(triggeredPage)).toBe('started');
    expect(isStatusLineComment(triggeredPage)).toBe(true);
    expect(commandReply('Actionable comments posted: 1')).toBeNull();
    const before = [
      { author: 'coderabbitai[bot]', body: 'Actionable comments posted: 1', anchor: 'pullrequestreview-1', createdAt: '2026-10-22T22:49:37Z' },
      { author: 'coderabbitai[bot]', body: 'Guard the empty list.', anchor: 'discussion_r1', createdAt: '2026-10-22T22:49:36Z', resolved: true },
      { author: 'brandonmcconnell', body: '@coderabbitai review', anchor: 'issuecomment-1', createdAt: '2026-10-26T04:57:04Z' },
    ];
    const status = (state: 'in_progress' | 'completed') => ({ name: 'CodeRabbit', status: state, conclusion: state === 'completed' ? ('success' as const) : null, sha: 'head' });
    const now = Date.parse('2026-10-26T22:00:00Z');
    // Nothing new to review: the earlier run stands whole, its one finding resolved, not that finding's count.
    const finished = { author: 'coderabbitai[bot]', body: finishedPage, anchor: 'issuecomment-2', createdAt: '2026-10-26T04:57:10Z', editedAt: '2026-10-26T05:03:14Z' };
    expect(verdictsFrom([status('completed')], [...before, finished], 'head', [], now)[0]).toMatchObject({ id: 'coderabbit', verdict: 'findings', count: 0, sourceId: 'discussion_r1' });
    // The check the request started, dated (the Action dates commit statuses): it began moments after the reply was
    // posted and closed green when the reply turned "finished". The run before stands, and the green check does not
    // turn it into "clean" once the report's grace runs out, whether or not the reply's rewrite is known yet.
    const dated = { ...status('completed'), startedAt: '2026-10-26T04:57:14Z', completedAt: '2026-10-26T05:03:12Z' };
    const unedited = { author: finished.author, body: finished.body, anchor: finished.anchor, createdAt: finished.createdAt };
    for (const reply of [finished, unedited]) {
      expect(verdictsFrom([dated], [...before, reply], 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, runJudged: true });
      const open = before.map((comment) => (comment.anchor === 'discussion_r1' ? { ...comment, resolved: false } : comment));
      expect(verdictsFrom([dated], [...open, reply], 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 1 });
    }
    // With the answer's rewrite known, that is the run's finish: a check begun 30 s after it (a review started on the
    // bot's own site, no trigger comment) that closes green with no report is the newer, clean run.
    const after = { ...dated, startedAt: '2026-10-26T05:03:44Z', completedAt: '2026-10-26T05:06:00Z' };
    expect(verdictsFrom([after], [...before, finished], 'head', [], now)[0]).toMatchObject({ verdict: 'clean', runJudged: true });
    // Still under way, the same check leaves the restored run standing rather than reading running until it closes; one
    // begun after the answer's finish is a newer run, running.
    const underWay = { ...status('in_progress'), startedAt: dated.startedAt };
    expect(verdictsFrom([underWay], [...before, finished], 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0 });
    expect(verdictsFrom([underWay], [...before, unedited], 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0 });
    expect(verdictsFrom([{ ...underWay, startedAt: '2026-10-26T05:03:44Z' }], [...before, finished], 'head', [], now)[0]?.verdict).toBe('running');
    // A first request, no earlier review: the check that ran for it is all there is, and its green or its "in progress"
    // would claim a review the reply says did not happen. No word, opening the reply.
    const firstOnly = [before[2]!, finished];
    expect(verdictsFrom([dated], firstOnly, 'head', [], now)[0]).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-2', runJudged: true });
    expect(verdictsFrom([underWay], firstOnly, 'head', [], now)[0]).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-2' });
    // The Action dates a commit status by its finish alone: a first request's green status with no start still claims
    // no review, and one finished before the request is not this request's.
    const statusOnlyFinish = { ...status('completed'), completedAt: '2026-10-26T05:03:12Z' };
    expect(verdictsFrom([statusOnlyFinish], firstOnly, 'head', [], now)[0]).toMatchObject({ verdict: 'unknown', sourceId: 'issuecomment-2', runJudged: true });
    expect(verdictsFrom([{ ...statusOnlyFinish, completedAt: '2026-10-26T04:00:00Z' }], firstOnly, 'head', [], now)[0]?.verdict).toBe('clean');
    // A later run that failed and posted nothing, hours after the answer, is its own: never hidden behind the old reply.
    const laterFailure = { ...status('completed'), conclusion: 'failure' as const, completedAt: '2026-10-26T09:00:00Z' };
    expect(verdictsFrom([laterFailure], firstOnly, 'head', [], now)[0]).toMatchObject({ verdict: 'failed' });
    // With no time at all (the page's commit statuses), only a green check is taken for the answered run.
    expect(verdictsFrom([status('completed')], firstOnly, 'head', [], now)[0]).toMatchObject({ verdict: 'unknown' });
    expect(verdictsFrom([{ ...status('completed'), conclusion: 'failure' as const }], firstOnly, 'head', [], now)[0]?.verdict).toBe('failed');
    // The run a still-open check left standing is judged, so an Action summary saved while the check ran gives way to it.
    expect(verdictsFrom([underWay], [...before, finished], 'head', [], now)[0]).toMatchObject({ verdict: 'findings', count: 0, runJudged: true });
    // A check begun hours after the answer is a newer run, judged on its own.
    const later = { ...dated, startedAt: '2026-10-26T09:00:00Z', completedAt: '2026-10-26T09:05:00Z' };
    expect(verdictsFrom([later], [...before, finished], 'head', [], now)[0]).toMatchObject({ verdict: 'clean', runJudged: true });
    // While it still says "Review triggered", the review is under way.
    const triggered = { author: finished.author, body: triggeredPage, anchor: finished.anchor, createdAt: finished.createdAt };
    expect(verdictsFrom([status('in_progress')], [...before, triggered], 'head', [], Date.parse('2026-10-26T04:58:00Z'))[0]?.verdict).toBe('running');
  });

  it('does not mistake a review, a status line or a question for a refusal', () => {
    expect(refusalReason('Bugbot reviewed your changes and found 2 potential issues.')).toBeNull();
    expect(refusalReason('Starting Devin Review.')).toBeNull();
    expect(refusalReason('Skipping the test suite here is intentional, see the PR description — the limit is per file.')).toBeNull();
    expect(refusalReason('No issues found; the subscription check in `billing.ts` could not be simpler.')).toBeNull();
  });

  it('does not mistake a short review about the code for a refusal', () => {
    // The code under review can be "disabled" or "not configured" too; a refusal says it about the bot or the review.
    expect(refusalReason('The `retry` flag is disabled in production, so this branch never runs.')).toBeNull();
    expect(refusalReason('Rate limiting is not configured for the new endpoint; see `limits.ts`.')).toBeNull();
    expect(refusalReason('This handler cannot access the session when called from the worker, which will throw.')).toBeNull();
    expect(refusalReason('The CI check is disabled on this branch and `permission denied` is swallowed in `run.sh`.')).toBeNull();
    // Nothing but the refusal, a few words with no subject before it, is a refusal even without naming anyone.
    expect(refusalReason('Permission denied.')).toBe('Permission denied');
    expect(refusalReason('Error: unable to access repository.')).toBe('Error: unable to access repository');
    expect(refusalReason('Unauthorized.')).toBe('Unauthorized');
    expect(refusalReason('Could not clone the repository, please try again later.')).toBe('Could not clone the repository, please try again later');
    expect(refusalReason('Unable to access private repository.')).toBe('Unable to access private repository');
    expect(refusalReason('Permission denied: `token`.')).toBe('Permission denied: token');
    expect(refusalReason('Could not clone repository: invalid credentials, please check the installation.')).toBe('Could not clone repository: invalid credentials, please check the installation');
    // A bare refusal may be followed by a line of advice, as long as nothing in the comment points at code.
    expect(refusalReason('Could not fetch repository. Check the token and retry.')).toBe('Could not fetch repository');
    expect(refusalReason('Permission denied. Install the app for this organization and run again.')).toBe('Permission denied');
    expect(refusalReason('Permission denied. Visit https://github.com/settings/installations to reconnect.')).toBe('Permission denied');
    // A link into the repository's files is a finding's evidence, not advice.
    expect(refusalReason('Cannot access repository. See https://github.com/org/repo/blob/main/src/auth.ts for the broken check.')).toBeNull();
    expect(refusalReason('Cannot access repository. See https://github.com/org/repo/pull/7/files#diff-abc for the check.')).toBeNull();
    expect(refusalReason('Permission denied. See https://docs.example.com/changes/access for help.')).toBe('Permission denied');
    expect(refusalReason('Cannot access repository. See https://example.com/x/auth#L42.')).toBeNull();
    expect(refusalReason('Cannot access repository. See [the check](https://example.com/x/auth#L42-L50) for why.')).toBeNull();
    expect(refusalReason('Cannot access repository. The worker lacks the GITHUB_TOKEN scope.')).toBeNull();
    expect(refusalReason('Cannot access repository. See `fetch.ts` for the retry loop.')).toBeNull();
    expect(refusalReason('Unable to read config. The loader in src/config/load.ts swallows the error.')).toBeNull();
    // A thing from the diff after the phrase makes a short sentence a finding, quoted or not; and "repository"
    // as a word in a finding ("repository secrets") is not the bot's subject — that needs "this"/"the"/"your".
    expect(refusalReason('Cannot access `foo` from the worker.')).toBeNull();
    expect(refusalReason('Cannot access repository secrets from the worker.')).toBeNull();
    expect(refusalReason('Unable to read repository config when the cache is cold.')).toBeNull();
    expect(refusalReason('Cannot access session from the worker.')).toBeNull();
    expect(refusalReason('Failed to read `config.json` on startup.')).toBeNull();
    expect(refusalReason('Cannot access `foo` here because the parameter shadows it.')).toBeNull();
    expect(refusalReason('The flag is disabled.')).toBeNull();
    expect(refusalReason('Reviews are not enabled for this repository.')).toBe('Reviews are not enabled for this repository');
    expect(refusalReason('CodeRabbit is currently paused for this organization. Resume it in the dashboard.')).toBe('CodeRabbit is currently paused for this organization');
  });

  it('is a failed verdict carrying the reason, sourced at the comment, after a trigger with no review before it', () => {
    const now = Date.UTC(2026, 9, 6, 6, 0);
    const comments = [
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-2', createdAt: '2026-10-06T05:49:27Z' },
      { author: 'cursor[bot]', body: skipping, anchor: 'issuecomment-3', createdAt: '2026-10-06T05:49:29Z' },
    ];
    const [bugbot] = verdictsFrom([], comments, 'aaa', [], now);
    expect(bugbot).toMatchObject({ id: 'bugbot', verdict: 'failed', sourceId: 'issuecomment-3', reason: 'Bugbot is disabled for this repository' });
    expect(bugbot?.count).toBeUndefined();
  });

  it('leaves the last real run standing when a later request is refused', () => {
    const now = Date.UTC(2026, 9, 6, 6, 0);
    const clean = [
      { author: 'cursor[bot]', body: 'Cursor Bugbot has reviewed your changes and found no issues.', anchor: 'issuecomment-1', createdAt: '2026-10-05T10:00:00Z' },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-2', createdAt: '2026-10-06T05:49:27Z' },
      { author: 'cursor[bot]', body: skipping, anchor: 'issuecomment-3', createdAt: '2026-10-06T05:49:29Z' },
    ];
    // The request is answered (not running) and the earlier review is what the chip shows.
    expect(verdictsFrom([], clean, 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'clean', sourceId: 'issuecomment-1' });
    const threads = [
      { author: 'cursor[bot]', body: 'Possible null dereference here.', anchor: 'discussion_r1', createdAt: '2026-02-04T10:00:00Z', resolved: false },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-2', createdAt: '2026-10-06T05:49:27Z' },
      { author: 'cursor[bot]', body: 'Skipping Bugbot: Bugbot could not find a matching SCM installation for this repository.', anchor: 'issuecomment-3', createdAt: '2026-10-06T05:49:29Z' },
    ];
    expect(verdictsFrom([], threads, 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'findings', count: 1 });
    // Old threads, a request the bot answered with a new summary, then a refused request: the summary is the last
    // real run, and the threads from before the answered request do not come back.
    const rerun = [
      { author: 'cursor[bot]', body: 'Possible null dereference here.', anchor: 'discussion_r1', createdAt: '2026-02-04T10:00:00Z', resolved: false },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-2', createdAt: '2026-03-01T10:00:00Z' },
      { author: 'cursor[bot]', body: 'Cursor Bugbot has reviewed your changes and found no issues.', anchor: 'issuecomment-3', createdAt: '2026-03-01T10:05:00Z' },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-4', createdAt: '2026-10-06T05:49:27Z' },
      { author: 'cursor[bot]', body: skipping, anchor: 'issuecomment-5', createdAt: '2026-10-06T05:49:29Z' },
    ];
    expect(verdictsFrom([], rerun, 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'clean', sourceId: 'issuecomment-3' });
    // Open threads, a request, the bot's "Starting", a second request, then the refusal: nothing was reported in
    // between, so the threads are still the last real run.
    const repeated = [
      { author: 'cursor[bot]', body: 'Possible null dereference here.', anchor: 'discussion_r1', createdAt: '2026-02-04T10:00:00Z', resolved: false },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-2', createdAt: '2026-10-06T05:40:00Z' },
      { author: 'cursor[bot]', body: 'Starting Bugbot review…', anchor: 'issuecomment-3', createdAt: '2026-10-06T05:40:05Z' },
      { author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-4', createdAt: '2026-10-06T05:49:27Z' },
      { author: 'cursor[bot]', body: skipping, anchor: 'issuecomment-5', createdAt: '2026-10-06T05:49:29Z' },
    ];
    expect(verdictsFrom([], repeated, 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'findings', count: 1 });
    // The bot's own "Starting" with no request, then a refusal: the threads before it stand too.
    const started = repeated.filter((_, index) => index === 0 || index === 2 || index === 4);
    expect(verdictsFrom([], started, 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'findings', count: 1 });
  });

  it('is loading, not failed, when an old request is the only word and the timeline is still being read', () => {
    const now = Date.UTC(2026, 9, 6, 22, 0);
    const comments = [{ author: 'brandonmcconnell', body: '@greptileai', anchor: 'issuecomment-9', createdAt: '2026-10-06T20:00:00Z', reactedBy: ['greptile-apps[bot]'] }];
    expect(verdictsFrom([], comments, 'aaa', [], now, { partial: true })[0]).toMatchObject({ id: 'greptile', verdict: 'loading', sourceId: 'issuecomment-9' });
    // Greptile reacted to the request and then never reviewed: it took the run, so the silence is the run's failure.
    expect(verdictsFrom([], comments, 'aaa', [], now)[0]).toMatchObject({ id: 'greptile', verdict: 'failed' });
    // The same request with no reaction is dropped within the grace as never seen — and past it, were it kept, would
    // be no word: nothing says the bot saw it.
    expect(verdictsFrom([], [{ author: 'brandonmcconnell', body: 'bugbot run', anchor: 'issuecomment-9', createdAt: '2026-10-06T20:00:00Z' }], 'aaa', [], now)[0]).toMatchObject({ id: 'bugbot', verdict: 'unknown' });
    // A fresh request is running either way.
    expect(verdictsFrom([], comments, 'aaa', [], Date.UTC(2026, 9, 6, 20, 1), { partial: true })[0]?.verdict).toBe('running');
  });

  it('round-trips the reason through the payload', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const withReason = { ...meta, bots: [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'failed' as const, reviewedSha: meta.headSha, sourceId: 'issuecomment-3', reason: 'Bugbot is disabled for this repository' }] };
    const body = renderSummary(withReason);
    expect(parseSummaryBody(body)).toEqual({ ok: true, value: withReason });
    // Readers without the extension see the same word as readers with it, and why.
    expect(body).toContain('Bugbot skipped (current): Bugbot is disabled for this repository');
    expect(body).not.toContain('Bugbot failed');
    const broke = { ...withReason, bots: [{ id: 'bugbot', login: 'cursor[bot]', verdict: 'failed' as const, reviewedSha: meta.headSha }] };
    expect(renderSummary(broke)).toContain('Bugbot failed (current)');
  });
});

describe('parseGeldPrMeta of rendered objects', () => {
  it('round-trips the fixture through JSON.parse', () => {
    const built = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    expect(parseGeldPrMeta(JSON.parse(JSON.stringify(built)))).toEqual({ ok: true, value: built });
  });
});
