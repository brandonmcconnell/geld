/**
 * Known review bots: logins, check-run names, re-run triggers, and the
 * config files that mean "this bot is installed". Extra logins from the
 * user's `reviewBots` setting are treated as unnamed bots.
 *
 * `configFiles` are paths whose presence in a repository is a fair sign the
 * bot reviews there (a trailing slash names a directory): the extension
 * checks them through GitHub's directory listing and offers such a bot on a
 * pull request it has not run on. Only a bot's *own* file counts; AGENTS.md
 * is read by Codex but written for every agent, so it says nothing.
 */

import type { BotVerdict } from './model';

export interface ReviewBot {
  readonly id: string;
  readonly title: string;
  readonly logins: readonly string[];
  readonly checkNames: readonly string[];
  /**
   * Check runs of the same App that are not its review, by name: a row named
   * like one of these is left alone though it contains a `checkNames` entry
   * ("Cursor Bugbot Autofix" is not the Bugbot review).
   */
  readonly notCheckNames?: readonly string[];
  /**
   * What the bot means by a `neutral` conclusion on its check. Bugbot's
   * docs: `success` is a run that found nothing, `neutral` one that found
   * something (its default for findings), `failure` only when configured to
   * fail on unresolved findings. Unset: neutral is a run that completed
   * without a word on the code (CodeRabbit's, Claude Code Review's).
   */
  readonly neutralConclusion?: 'findings';
  readonly triggers: readonly string[];
  readonly configFiles: readonly string[];
  /**
   * The GitHub App's id, which is where its mark lives
   * (`avatars.githubusercontent.com/in/<id>`): the fallback picture for a bot
   * the page shows no image of (offered before it has run here). Read from
   * `GET /users/<login>` in Oct 2026; `avatars.githubusercontent.com/<login>`
   * serves an identicon for App logins, not the mark.
   */
  readonly appId?: number;
  /**
   * A coding agent that also reviews: most of its comments are replies and
   * progress notes (to a person, or to another bot's review), so only a
   * comment shaped like a review (a score, a findings count, "no issues")
   * counts as its verdict.
   */
  readonly conversational?: boolean;
  /**
   * How the bot says it has picked a trigger comment up. `reaction`: it
   * reacts to the comment (Greptile's 👍) the moment it takes the job, so a
   * trigger it has not reacted to after `ACK_GRACE_MS` was never seen — the
   * bot is not running, whatever the comment asked (seen on mintlify/mint
   * #12546: a bare "@greptileai" with no reaction and no review for half an
   * hour, the next one reacted to within seconds and reviewed). Unset for
   * bots that start silently: their trigger counts until it ages.
   */
  readonly acknowledges?: 'reaction';
}

/** A bot that acknowledges triggers with a reaction has this long to do so; past it an unreacted trigger is not a run. */
export const ACK_GRACE_MS = 3 * 60 * 1000;

export const REVIEW_BOTS: readonly ReviewBot[] = [
  {
    id: 'bugbot',
    title: 'Bugbot',
    appId: 1210556,
    logins: ['cursor[bot]', 'cursor-bugs[bot]', 'bugbot[bot]', 'cursor-com[bot]'],
    checkNames: ['Cursor Bugbot', 'Bugbot'],
    notCheckNames: ['Cursor Bugbot Autofix', 'Bugbot Autofix'],
    neutralConclusion: 'findings',
    triggers: ['bugbot run', 'cursor review', '@cursor review'],
    configFiles: ['.cursor/BUGBOT.md'],
    // The login is also Cursor's cloud agents' and automations': they reply in threads, answer other bots
    // ("@greptileai Both P1 findings are addressed… Please re-review", mint#13111) and post "Verdict: …" reviews.
    // Bugbot's own summaries are always review-shaped ("found no new issues", "found N potential issues"), so only
    // those, and an automation's stated verdict, vote.
    conversational: true,
  },
  {
    id: 'greptile',
    title: 'Greptile',
    appId: 867647,
    logins: ['greptile-apps[bot]', 'greptile[bot]'],
    checkNames: ['Greptile'],
    triggers: ['@greptileai', '@greptile', '@greptileai review'],
    configFiles: ['greptile.json', '.greptile.yml', '.greptile.yaml'],
    acknowledges: 'reaction',
  },
  {
    // Devin is a coding agent as well as a reviewer, under the same login: on a pull request it opened it narrates
    // ("I'll fix CI failures and address comments…", "Tested commit abc in a browser…"), and those read as findings.
    // Only a review-shaped comment votes; Devin Review's always are ("found N potential issues", "No Issues Found").
    id: 'devin',
    title: 'Devin',
    appId: 811515,
    logins: ['devin-ai-integration[bot]', 'devin[bot]'],
    checkNames: ['Devin'],
    triggers: ['/devin review', '@devin review', '@devin'],
    configFiles: [],
    conversational: true,
  },
  {
    id: 'codex',
    title: 'Codex',
    appId: 1144995,
    logins: ['chatgpt-codex-connector[bot]', 'openai-codex[bot]', 'codex[bot]'],
    checkNames: ['Codex'],
    triggers: ['@codex review', '@codex'],
    configFiles: ['.codex/'],
  },
  {
    id: 'copilot',
    title: 'Copilot',
    appId: 946600,
    logins: ['copilot-pull-request-reviewer[bot]', 'copilot[bot]'],
    checkNames: ['Copilot code review', 'Copilot'],
    triggers: ['@copilot'],
    configFiles: ['.github/copilot-instructions.md'],
  },
  {
    id: 'coderabbit',
    title: 'CodeRabbit',
    appId: 347564,
    logins: ['coderabbitai[bot]'],
    checkNames: ['CodeRabbit'],
    triggers: ['@coderabbitai review', '@coderabbitai full review', '@coderabbitai'],
    configFiles: ['.coderabbit.yaml', '.coderabbit.yml'],
  },
  {
    id: 'gemini',
    title: 'Gemini Code Assist',
    appId: 956858,
    logins: ['gemini-code-assist[bot]'],
    checkNames: ['Gemini Code Assist', 'gemini-code-assist'],
    triggers: ['@gemini-code-assist'],
    // Gemini Code Assist on GitHub reads `.gemini/config.yaml` and `.gemini/styleguide.md`.
    configFiles: ['.gemini/'],
  },
  {
    // Capy (capy.ai, GitHub App "Capy AI" by Scrapybara): a review agent that posts findings at or above the
    // repository's severity threshold as inline review comments and resolves their threads as they are fixed;
    // `@capy review` on the PR starts a round (trailing words are its instructions). Verified against the App
    // registry and docs.capy.ai/review in Oct 2026; no check run documented.
    id: 'capy',
    title: 'Capy',
    appId: 1915919,
    logins: ['capy-ai[bot]', 'capy[bot]'],
    checkNames: ['Capy AI', 'Capy Review', 'Capy'],
    triggers: ['@capy review'],
    configFiles: ['.capy/'],
  },
  {
    // Replicas (replicas.dev): cloud coding agents with a "Code Review" automation that posts an X/5 review score
    // on PR open and sync; `/replicas run code-review` runs it on demand, `@tryreplicas` addresses the agent.
    id: 'replicas',
    title: 'Replicas',
    appId: 2176876,
    logins: ['replicas-connector[bot]', 'replicas-dev[bot]', 'tryreplicas[bot]'],
    checkNames: ['Replicas'],
    triggers: ['/replicas run code-review', '@tryreplicas review', '@tryreplicas', '@replicas'],
    configFiles: [],
    conversational: true,
  },
  {
    // Claude Code Review (Anthropic's managed GitHub App, `claude[bot]`): findings as inline comments ranked by
    // severity, a summary review ("I reviewed this PR and found no bugs (no blocking findings)", "Nothing blocking.",
    // "## Code review / No issues found") and a check run named "Claude Code Review" that never concludes failure.
    // `@claude review` starts one (`always` subscribes the PR, `once` does not); Claude reacts 👀 when it takes the
    // comment. The same login is Claude Code's GitHub Action and the "PR Steward", which narrate ("Claude finished
    // @x's task in 45s", "Picking this one up…"), so only a review-shaped comment votes. REVIEW.md holds the review
    // rules (CLAUDE.md is read too, but every Claude Code user has one). Docs read Oct 2026 (code.claude.com/docs/en/code-review).
    id: 'claude',
    title: 'Claude Code Review',
    appId: 1236702,
    logins: ['claude[bot]'],
    checkNames: ['Claude Code Review'],
    triggers: ['@claude review', '@claude review always', '@claude review once'],
    // REVIEW.md only: CLAUDE.md is every Claude Code user's file and says nothing about Code Review being on.
    configFiles: ['REVIEW.md'],
    conversational: true,
    acknowledges: 'reaction',
  },
  {
    // cubic (cubic.dev, `cubic-dev-ai[bot]`): a review per push with a bold count line — "**N issues found** across
    // M files", "**No issues found**", "**All reported issues were addressed**", "**1 existing issue remains and 3
    // new issues found**" — sometimes with a "Confidence score: **N/5**". `@cubic-dev-ai review this PR` (or the bare
    // mention) runs a full review, `@cubic-dev-ai incremental review` the changes since the last; it reacts 👀 to
    // the comment. `cubic.yaml` at the root configures it; the review shows as a check run that can be cancelled
    // from the Checks UI. Docs read Oct 2026 (docs.cubic.dev).
    id: 'cubic',
    title: 'cubic',
    appId: 1082092,
    logins: ['cubic-dev-ai[bot]'],
    checkNames: ['cubic'],
    triggers: ['@cubic-dev-ai review this PR', '@cubic-dev-ai review', '@cubic-dev-ai incremental review', '@cubic-dev-ai', '@cubic review'],
    configFiles: ['cubic.yaml'],
    acknowledges: 'reaction',
    conversational: true,
  },
  {
    // Sourcery (`sourcery-ai[bot]`): a "Reviewer's Guide" comment maps the change, then a review — "Hey - I've
    // reviewed your changes and they look great!" with "### Sourcery assessment **Approved.**", or "Hey - I've found
    // N issues". A status check named "Sourcery review" reports in progress / success / failure (blocking security
    // findings) / skipped (rate limit, the five-re-review cap). Budget refusals: "Sorry @x, you've used your own
    // review budget of 250,000 diff characters for the last 7 days", "your pull request is larger than the review
    // limit". `@sourcery-ai review` re-reviews from scratch. Docs read Oct 2026 (docs.sourcery.ai/reviews).
    id: 'sourcery',
    title: 'Sourcery',
    appId: 48477,
    logins: ['sourcery-ai[bot]'],
    checkNames: ['Sourcery review', 'Sourcery'],
    triggers: ['@sourcery-ai review', '@sourceryai review'],
    configFiles: ['.sourcery.yaml'],
    conversational: true,
  },
  {
    // Qodo (qodo.ai, `qodo-code-review[bot]`; Qodo Merge / PR-Agent before it): a "PR Summary by Qodo" and a "Code
    // Review by Qodo" headed by counts in code pills ("🐞 Bugs (0)", "📘 Rule violations (0)" …), a "Qodo is busy
    // working" status line while it runs, and billing notices ("Qodo reviews are paused because your trial has
    // ended"). `/agentic_review` runs a review (`/review` and `/improve` are the deprecated PR-Agent forms);
    // `.pr_agent.toml` configures it. Docs read Oct 2026 (docs.qodo.ai/code-review).
    id: 'qodo',
    title: 'Qodo',
    appId: 484649,
    logins: ['qodo-code-review[bot]', 'qodo-merge-pro[bot]', 'codiumai-pr-agent-pro[bot]', 'qodo-merge-for-open-source[bot]'],
    checkNames: ['Qodo'],
    triggers: ['/agentic_review', '/review', '@qodo review'],
    configFiles: ['.pr_agent.toml'],
    conversational: true,
  },
  {
    // Amazon Q Developer (`amazon-q-developer[bot]`): a review headed "## Review Summary" with the findings as
    // threads; "No blocking defects were found", "No blocking issues found", "No logic errors, security
    // vulnerabilities, crashes, or behavioral regressions were found" when clean. Reviews run on open/reopen only;
    // `/q review` in a new comment runs one again, `/q <question>` asks. Docs read Oct 2026 (docs.aws.amazon.com/amazonq).
    id: 'amazon-q',
    title: 'Amazon Q Developer',
    appId: 1220912,
    logins: ['amazon-q-developer[bot]'],
    checkNames: ['Amazon Q Developer'],
    triggers: ['/q review'],
    configFiles: [],
  },
  {
    // Ellipsis (ellipsis.dev, `ellipsis-dev[bot]`): one review per admitted push combining its reviewers' findings;
    // an important-alert "**Looks good to me! :+1:**" with "Reviewed everything up to <sha>" when clean, a request
    // for changes with the comments otherwise. Configured by `.ellipsis/code-review.yaml`; reviews are push-driven
    // (no comment command documented). Docs read Oct 2026 (ellipsis.dev/docs/code-review).
    id: 'ellipsis',
    title: 'Ellipsis',
    appId: 64358,
    logins: ['ellipsis-dev[bot]'],
    checkNames: ['Ellipsis'],
    triggers: ['@ellipsis-dev review'],
    configFiles: ['.ellipsis/code-review.yaml', 'ellipsis.yaml'],
  },
  {
    // Macroscope (macroscope.com, `macroscopeapp[bot]`): findings as comments, then an "#### Approvability" comment
    // with "**Verdict:** Approved at `sha`" / "Would Approve" / "Needs Human Approval"; "Macroscope skipped reviewing
    // this pull request. Per-review cost limit exceeded" when it will not run. `@macroscope-app review` starts one.
    // Docs read Oct 2026 (docs.macroscope.com).
    id: 'macroscope',
    title: 'Macroscope',
    appId: 900172,
    logins: ['macroscopeapp[bot]', 'macroscope-app[bot]'],
    checkNames: ['Macroscope'],
    triggers: ['@macroscope-app review', '@macroscopeapp review'],
    configFiles: [],
    conversational: true,
  },
  {
    // Korbit (korbit.ai, `korbit-ai[bot]`): a review headed "### Review by Korbit AI" with a table of issues and
    // their fix status ("✅ Fix detected"); "By default, I don't review pull requests opened by bots" when it skips.
    // `/korbit-review` requests one. Seen on apache/superset, Oct 2026.
    id: 'korbit',
    title: 'Korbit',
    appId: 322216,
    logins: ['korbit-ai[bot]'],
    checkNames: ['Korbit'],
    triggers: ['/korbit-review'],
    configFiles: ['.korbit/'],
  },
  {
    // Entelligence (entelligence.ai, `entelligence-ai-pr-reviews[bot]`): an "## EntelligenceAI PR Summary", a
    // "## Walkthrough", findings as threads plus "## Findings outside the diff (N)" comments, and "Starting fresh pr
    // review. This may take a few minutes" while it runs; "**Automatic Review Skipped** This PR changes N files,
    // above the 100-file limit" when it will not. `@entelligence review` runs one; `@entelligence help` lists the
    // commands. Seen Oct 2026.
    id: 'entelligence',
    title: 'Entelligence',
    appId: 932812,
    logins: ['entelligence-ai-pr-reviews[bot]', 'entelligence-ai[bot]'],
    checkNames: ['Entelligence'],
    triggers: ['@entelligence review'],
    configFiles: [],
    conversational: true,
  },
];

const LOGIN_INDEX = new Map<string, ReviewBot>();
for (const bot of REVIEW_BOTS) {
  for (const login of bot.logins) LOGIN_INDEX.set(login.toLowerCase(), bot);
}

export function botById(id: string): ReviewBot | null {
  return REVIEW_BOTS.find((bot) => bot.id === id) ?? null;
}

export function botByLogin(login: string): ReviewBot | null {
  return LOGIN_INDEX.get(login.toLowerCase()) ?? null;
}

export function botByCheckName(name: string): ReviewBot | null {
  const lower = name.toLowerCase();
  return REVIEW_BOTS.find((bot) => bot.checkNames.some((check) => lower.includes(check.toLowerCase())) && !(bot.notCheckNames ?? []).some((check) => lower.includes(check.toLowerCase()))) ?? null;
}

/**
 * Two readings of the same head's checks as one list: `primary` (the page's
 * merge box rows, live — a running row shows its spinner and start) for
 * every check it names, `secondary` (the commit's status partial, which
 * lists every check whether or not the merge box is expanded) for the rest.
 * Names are compared whole, case-insensitively.
 */
export function mergeCheckRuns(primary: readonly RawCheckRun[], secondary: readonly RawCheckRun[]): readonly RawCheckRun[] {
  const named = new Set(primary.map((check) => check.name.toLowerCase()));
  return [...primary, ...secondary.filter((check) => !named.has(check.name.toLowerCase()))];
}

/** GitHub Apps and the `[bot]` suffix, plus any login in the registry. */
export function looksLikeBotLogin(login: string): boolean {
  return login.endsWith('[bot]') || botByLogin(login) !== null;
}

/**
 * Resolve a login to a bot id. Extra user-supplied logins become `custom:<login>`.
 */
export function resolveBotId(login: string, extraLogins: readonly string[] = []): string | null {
  const known = botByLogin(login);
  if (known !== null) return known.id;
  const extra = extraLogins.some((entry) => entry.toLowerCase() === login.toLowerCase());
  if (extra || login.endsWith('[bot]')) return `custom:${login.toLowerCase()}`;
  return null;
}

export function botTitle(id: string, login: string): string {
  const known = botById(id);
  if (known !== null) return known.title;
  if (id.startsWith('custom:')) return login.replace(/\[bot\]$/i, '');
  return login;
}

export type FindingSeverity = 'low' | 'medium' | 'high';

export interface ParsedBotBody {
  readonly count: number | null;
  readonly score: number | null;
  readonly clean: boolean;
  /** Worst severity the bot named ("high severity", "critical", "security"). */
  readonly severity: FindingSeverity | null;
  /**
   * The comment states a verdict in so many words without a count or a
   * score to show for it: "Needs a human reviewer." (Sourcery), "Needs Human
   * Approval" (Macroscope), "Verdict: request changes" (a Cursor automation
   * under the Bugbot login). Review-shaped (`isReviewShaped`) though nothing
   * else about it is.
   */
  readonly verdict?: 'needs-human' | 'changes-requested';
}

/**
 * Whether a bot's comment is its review rather than something else it said:
 * a conversational bot's chat, guide, summary or progress note votes for
 * nothing. A count, a score, a clean word or a stated verdict make a review.
 */
export function isReviewShaped(parsed: ParsedBotBody): boolean {
  return parsed.count !== null || parsed.score !== null || parsed.clean || parsed.verdict !== undefined;
}

/**
 * Pull a findings count or score out of a bot's summary comment. Conservative:
 * unknown shapes return nulls rather than inventing numbers.
 */
/**
 * Counts in a bot's own shape, where the generic "N issues" reading misses or
 * misreads: null when the body is not in that shape.
 *
 * - Claude: "Review complete — changes requested (0 P1, 3 P2, 3 P3)" and "Has
 *   P1/P2 findings, changes requested: 1 P1, 1 P2, 2 P3" — P1 + P2 are the
 *   findings, P3 the nits ("2 P3" read as two issues otherwise).
 * - cubic: "**1 existing issue remains and 3 new issues found**" — both.
 * - Qodo: "🐞 Bugs (0) 📘 Rule violations (0) 📎 Requirement gaps (0) …" — the
 *   pills' sum.
 * - Korbit: a "Review by Korbit AI" table, one row per issue, "✅ Fix detected"
 *   on the rows since fixed.
 * - Entelligence: the "**Issues found:**" list under its scorecard; a
 *   scorecard with no such list found nothing.
 */
function countShapedBy(botId: string, text: string): number | null {
  switch (botId) {
    case 'claude': {
      const match = /(\d+)\s*P1,\s*(\d+)\s*P2/i.exec(text);
      return match?.[1] !== undefined && match[2] !== undefined ? Number.parseInt(match[1], 10) + Number.parseInt(match[2], 10) : null;
    }
    case 'cubic': {
      const existing = /(\d+)\s+existing\s+issues?\s+remains?/i.exec(text);
      const found = /(\d+)\s+(?:new\s+)?issues?\s+found/i.exec(text);
      if (existing === null && found === null) return /\bno (?:new )?issues found\b|\ball reported issues were addressed\b/i.test(text) ? 0 : null;
      return (existing?.[1] === undefined ? 0 : Number.parseInt(existing[1], 10)) + (found?.[1] === undefined ? 0 : Number.parseInt(found[1], 10));
    }
    case 'qodo': {
      if (!/code review by qodo/i.test(text)) return null;
      let sum = 0;
      let any = false;
      for (const match of text.matchAll(/(?:bugs|rule violations|requirement gaps|cross-repo conflicts|skill insights)\s*\((\d+)\)/gi)) {
        sum += Number.parseInt(match[1] ?? '0', 10);
        any = true;
      }
      return any ? sum : null;
    }
    case 'korbit': {
      if (!/review by korbit/i.test(text)) return null;
      // Each issue row ends its title with "▹ [view](…)" to the thread, raw ("| <sub>![Security](…)</sub> | Overly
      // broad … ▹ [view](…) | ✅ Fix detected |") and as the page reads it (a `tr` is a line, its cells' words run
      // together: "Overly broad … ▹ view ✅ Fix detected"); the badge image has no words of its own.
      const rows = text.split('\n').filter((line) => /\u25b9\s*\[?view\b/i.test(line));
      return rows.filter((line) => !/fix detected/i.test(line)).length;
    }
    case 'entelligence': {
      if (!/review scorecard/i.test(text)) return null;
      const lines = text.split('\n');
      const start = lines.findIndex((line) => /^\s*(?:[-*]\s+)?\*\*Issues found:?\*\*:?\s*$/i.test(line));
      if (start < 0) return /\bnothing to flag\b|\bno (?:critical or significant |significant )?issues found\b/i.test(text) ? 0 : null;
      // One item per line — "- **Significant** `path` — title" raw, "**Significant** `path` — title" as the page reads
      // a list item (blank lines between them there) — until a line that is neither an item nor the "*…plus 23 more,
      // posted as inline comment(s)*" that closes a long list.
      let count = 0;
      for (const line of lines.slice(start + 1)) {
        if (line.trim() === '') continue;
        if (/^\s*(?:[-*]\s+)?\*\*[^*\n]+\*\*\s+\S/.test(line)) {
          count += 1;
          continue;
        }
        const more = /plus (\d+) more/i.exec(line);
        if (more?.[1] !== undefined) count += Number.parseInt(more[1], 10);
        break;
      }
      return count;
    }
    default:
      return null;
  }
}

export function parseBotBody(body: string, botId: string): ParsedBotBody {
  // HTML comments are the bots' own markers (Cursor's automation ids, Greptile's score), never words to weigh.
  const text = body.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').trim();
  // Entelligence's scorecard has two N/5 rows; "Merge Confidence" is the verdict (Code Quality feeds it). Qodo's
  // summaries carry no score out of five, whatever fraction appears in them.
  const scoreMatch = botId === 'qodo' ? null : (botId === 'entelligence' ? /merge confidence\W+(?:[\u25cf\u25cb\s]*)\**(\d+(?:\.\d+)?)\s*\/\s*5\b/i.exec(text) : null) ?? /(\d+(?:\.\d+)?)\s*\/\s*5\b/.exec(text);
  const score = scoreMatch?.[1] !== undefined ? Number.parseFloat(scoreMatch[1]) : null;
  // "found 1 potential issue", "2 new bugs": one qualifier between the number and the noun is allowed through.
  // CodeRabbit counts the other way round: "Actionable comments posted: 1" on each review.
  const countMatch =
    botId === 'greptile'
      ? /(?:found|reported)\s+(\d+)\s+(?:issue|finding|comment)/i.exec(text)
      : (/\bactionable comments posted:\s*(\d+)/i.exec(text) ??
        // Not a number that is a reference ("#9377", "GH-123"): "both #9377 findings are fixed" names a pull request, not 9,377 findings
        // (server#9385, where the Bugbot chip read "9377 issues" until its threads settled).
        /(?<![#\w-])(\d+)\s+(?:(?:potential|possible|new|actionable|likely|minor|major|critical|significant|remaining|open|existing)\s+){0,2}(?:issue|finding|bug|problem)s?\b/i.exec(text));
  let count = countMatch?.[1] !== undefined ? Number.parseInt(countMatch[1], 10) : null;
  const shaped = countShapedBy(botId, text);
  if (shaped !== null) count = shaped;
  // Greptile's summary (the one headed "Confidence Score: N/5") lists what it found under a "Findings" heading, one
  // bold title per finding ("1. **Review cards lack test coverage** ▶" raw, "**Review cards lack test coverage** ▶"
  // as the page reads a list item); a summary with no such section found nothing, whatever its risk sentence says
  // ("appears safe to merge", "no blocking issue remains" — the wording varies run to run). The section's items are
  // counted; a section whose items cannot be read leaves the count unknown rather than claiming a clean run.
  if (botId === 'greptile' && count === null && /\bconfidence score\b/i.test(text)) {
    // Raw, the headings are HTML (`<h2>Findings</h2>`, `<summary><h3>Summary</h3></summary>`); the tags go first.
    const plain = text.replace(/<[^>]+>/g, '');
    const section = /^\s*(?:#{1,6}\s*)?Findings\s*$\n([\s\S]*?)(?=^\s*(?:#{1,6}\s*)?(?:Summary|Reviews \(\d+\))\b|(?![\s\S]))/im.exec(plain);
    if (section === null) count = 0;
    else {
      const items = (section[1] ?? '').split('\n').filter((line) => /\*\*[^*]+\*\*/.test(line)).length;
      if (items > 0) count = items;
    }
  }
  // "found no new issues", "no further problems", "0 potential issues", "No open issues" (Copilot's overview once
  // every finding is resolved, beside "N open findings" while some are): the adjectives between "no" and the noun
  // vary by bot and by run, so a few are allowed through. CodeRabbit's clean word is "No actionable comments were
  // generated in the recent review". A scored summary that lists no findings (Greptile, above) is clean with its score.
  // "Didn't find any major issues" (Codex); a coding agent's review verdict ("Verdict: approve", "Approved."), as
  // Cursor's automations post under the Bugbot login. A verdict beside a count of findings ("Didn't find any major
  // issues. Found 2 minor issues.") is not clean: the count is. The bare "Approved" must be the verdict word — followed
  // by its punctuation or nothing — not the first word of a finding ("Approved users can edit another tenant's settings").
  // "**Verdict:** Approved at `sha`" / "Would Approve" (Macroscope), "Sourcery assessment **Approved.**", "Review
  // complete — approved (0 P1, 0 P2, 2 P3)" (Claude): the verdict word after its label, through the bold marks.
  const approved =
    (count === null || count === 0) &&
    (/\b(?:didn.t|did not|couldn.t|could not) find any(?: \w+)? (?:issues|bugs|problems|findings)\b/i.test(text) ||
      /\b(?:verdict|assessment)\W{0,6}(?:would\s+)?approved?\b/i.test(text) ||
      /\breview complete\s*[\u2014\u2013-]+\s*approved\b/i.test(text) ||
      /^\s*(?:[#>*_\s]*)approved[*_]*\s*(?:[.!:;\u2014\u2013-]|$)/i.test(text));
  // A count of findings is findings, whatever else the summary says ("1 existing issue remains and no new issues
  // found", cubic). "Nothing blocking." (Claude), "No blocking defects were found" (Amazon Q), "they look great"
  // (Sourcery), "All reported issues were addressed" (cubic: nothing outstanding), "The PR is ready to merge".
  // "Needs a human reviewer." (Sourcery's assessment), "Needs Human Approval" (Macroscope's verdict): the bot would
  // not sign off, whatever kind words came before ("they look great!").
  // ...a negated one ("does not need human approval") is no verdict; "not only needs human approval" is one still.
  const needsHuman = /\bneeds? (?:a )?human (?:review(?:er)?|approval)\b/i.test(text.replace(/\b(?:not|no|never|without|doesn.t|does not|don.t|do not|didn.t|did not)\b(?!\s+(?:only|just|merely)\b)(?:\s+\w+){0,2}\s+needs? (?:a )?human (?:review(?:er)?|approval)\b/gi, ''));
  // "The PR is ready to merge" (Amazon Q) — unless the sentence says it is not ("not yet ready to merge", "isn't
  // ready to merge", "before it is ready to merge").
  const readyToMerge =
    /\bready to merge\b/i.test(text) &&
    !/\b(?:not|isn.t|aren.t|never|before|until|far from|nowhere near)\b(?:\s+\w+){0,3}\s+ready to merge\b/i.test(text) &&
    // ...nor with a condition after it ("ready to merge after the failing check is fixed", "once …", "if …").
    !/\bready to merge\s+(?:after|once|when|if|provided|pending|following|as soon as|but|except|unless)\b/i.test(text);
  const clean =
    !needsHuman &&
    (count === null || count === 0) &&
    (/\bno(?: (?:new|further|additional|other|remaining|potential|actionable|significant|blocking|logic|open))* (?:issues|bugs|findings|problems|defects|errors)\b/i.test(text) ||
      /\bno actionable comments\b/i.test(text) ||
      /\b(?:looks good|lgtm|all clean|no bugs found|nothing blocking|they look great|all reported issues were addressed)\b/i.test(text) ||
      readyToMerge ||
      approved ||
      (count === 0 && (score === null || botId === 'greptile' || shaped !== null)));
  // A severity word under a negation is not a severity: "no established behavioral blocker", "no critical issues",
  // "without security risk". The denied phrase goes before the words are weighed.
  const affirmed = text.replace(/\b(?:no|not|without|zero|non-)(?:\s+\w+){0,3}[\s-]+(?:high severity|critical|blockers?|blocking|security (?:issues?|vulnerabilit(?:y|ies)|risks?))\b/gi, '');
  const severity: FindingSeverity | null = /\b(?:high severity|critical|blocker|security (?:issue|vulnerability|risk))\b/i.test(affirmed)
    ? 'high'
    : /\bmedium(?: severity| risk)?\b/i.test(affirmed)
      ? 'medium'
      : /\blow(?: severity| risk)?\b/i.test(affirmed)
        ? 'low'
        : null;
  const changesRequested = /\b(?:verdict|assessment)\W{0,6}(?:request(?:s|ed)? changes|changes requested)\b/i.test(text);
  const verdict = needsHuman ? ({ verdict: 'needs-human' } as const) : changesRequested ? ({ verdict: 'changes-requested' } as const) : {};
  return { count: Number.isFinite(count) ? count : null, score: Number.isFinite(score) ? score : null, clean, severity, ...verdict };
}

export interface RawCheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly sha: string;
  /** Where the check's "Details" lead (an external service's page for a status it posted), when known. */
  readonly detailsUrl?: string;
  /** The check's one-line description as GitHub shows it ("Failing after 6m", "— 3 changes must be accepted"). */
  readonly description?: string;
  /**
   * When the run began, ISO, when known: the API's `startedAt`, or on the
   * page the "Started …" time GitHub shows while a check runs (kept once it
   * has finished, run-starts.ts). What lets a finished check's report be told
   * from the summary of the run before it (see `verdictsFrom`).
   */
  readonly startedAt?: string;
  /**
   * When the run was seen to have finished, ISO, when known: the API's
   * `completedAt`, or on the page the first pass that found the row
   * completed. The report's grace (`REPORT_GRACE_MS`) runs from here.
   */
  readonly completedAt?: string;
}

export interface DerivedBotVerdict {
  readonly id: string;
  readonly login: string;
  readonly verdict: BotVerdict;
  readonly count?: number;
  readonly score?: number;
  readonly severity?: FindingSeverity;
  readonly reviewedSha: string;
  readonly checkName?: string;
  readonly sourceId?: string;
  /** The bot's own words for a run it refused (`refusalReason`). */
  readonly reason?: string;
  /**
   * The verdict was judged against the check's known start: either a report
   * newer than it, or the check alone once the report's grace ran out. Set
   * only when `RawCheckRun.startedAt` was known; a page that opened after the
   * check finished cannot say and leaves it unset. Also set when the bot's
   * refusal ended a check left under way (its own words judged the run).
   */
  readonly runJudged?: true;
}

/**
 * A bot saying it did *not* review — the run was refused, not run: "Skipping
 * Bugbot: Bugbot is disabled for this repository", "not enabled for this
 * repo", "no credits remaining", "could not access the repository". Such a
 * comment is a `failed` verdict carrying the bot's sentence as its reason,
 * never findings (its words hold no count) and never a status line (nothing
 * is under way). Short — a refusal is a sentence or two with a link to fix
 * it — and shaped like one.
 */
export function refusalReason(body: string): string | null {
  const untagged = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(?:h[1-6]|p|div|br|li|ul|ol|details|summary|blockquote)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  // A block ends a sentence: a heading carries no full stop, and merged into the explanation under it the
  // explanation's words would weigh on the heading's reading. Blocks are what a blank line or a heading line
  // separates (HTML block tags became line breaks above); a soft-wrapped Markdown line is the same sentence.
  const blocks: string[] = [];
  for (const raw of untagged.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split('\n')) {
    // A heading inside a blockquote ("> ### Permission denied") is a heading still.
    const heading = /^\s*(?:>\s*)*#{1,6}\s/.test(raw);
    const line = raw.replace(/[`*_>~#]/g, '').replace(/\s+/g, ' ').trim();
    const last = blocks.length - 1;
    if (line === '' || heading || last < 0 || blocks[last] === '') blocks.push(line);
    else blocks[last] = `${blocks[last]} ${line}`;
    if (heading) blocks.push('');
  }
  const text = blocks
    .filter((block) => block !== '')
    // A block ending in a colon ends there too ("Permission denied:" over its advice), or the advice would weigh on it.
    .map((block) => (/[.!?;,]$/.test(block) ? block : `${block.replace(/:$/, '')}.`))
    .join(' ')
    .trim();
  if (text === '') return null;
  // A notice headed by its reason, over an explanation too long for the cap below: Bugbot's "Bugbot couldn't run -
  // usage limit reached" and "Bugbot needs on-demand usage enabled" (an <h3>, raw; the first line as the page reads
  // it). The heading is the reason — when it is about the bot or its usage, not about the code ("Cannot run
  // migrations on a fresh database" heads a finding).
  const heading = untagged
    .split('\n')
    .map((line) => line.replace(/[`*_>~#]/g, '').replace(/\s+/g, ' ').trim())
    .find((line) => line !== '');
  // A bot naming itself in a heading that says it did not run — "**Macroscope skipped reviewing this pull request.**"
  // over the cost explanation, "**Claude encountered an error after 48s** —— [View job](…)" over what it was doing.
  // The heading is the reason, without the job link after the dash.
  if (heading !== undefined && /^[A-Z][\w.-]*(?:\[bot\])?\s+(?:skipped reviewing\b|encountered an error\b)/.test(heading)) {
    const lower = heading.toLowerCase();
    if (REVIEW_BOTS.some((bot) => lower.startsWith(bot.title.toLowerCase()) || bot.logins.some((login) => lower.startsWith(login.replace(/\[bot\]$/, '').toLowerCase())))) {
      const first = heading.replace(/\s*[\u2014\u2013-]{2,}.*$/, '').split(/(?<=[.!?])\s+/)[0] ?? heading;
      return first.replace(/[.!?]\s*$/, '');
    }
  }
  if (heading !== undefined && heading.length <= 120 && /\b(?:couldn.t run|could not run|cannot run|can.t run|needs? [^.]{0,60}\benabled|usage limits? (?:(?:has|have|was|were) been )?reached|quota (?:limit )?reached|out of credits)\b/i.test(heading)) {
    // A run-failure heading ("couldn't run …") must name the bot (a known title or login): "review" or "quota" in it
    // is not enough — "Cannot run review tests on a fresh checkout", "Cannot run quota migrations on a fresh
    // database" head findings. A heading that is itself about usage, credits or quota ("Usage limit reached") may
    // leave the bot unnamed.
    const lower = heading.toLowerCase();
    const named = botNamedIn(lower);
    const runFailure = /\b(?:couldn.t run|could not run|cannot run|can.t run)\b/i.test(heading);
    const aboutBot = named || (!runFailure && /\b(?:usage|credits?|quota|billing|limits?)\b/i.test(heading));
    if (aboutBot) return heading.replace(/[.!?]\s*$/, '');
  }
  // CodeRabbit's skip notice: a "Review skipped" heading in an alert ("[!IMPORTANT]" raw, "Important" as the page
  // reads it), then the reason as the first sentence, then its run configuration — long, so read before the length
  // cap below. "Auto reviews are disabled on base/target branches other than the default branch"; "Review was skipped
  // as selected files did not have any reviewable changes" (an incremental pass with nothing to read — a refusal only
  // for a bot that never reviewed here, as any refusal is).
  const skipNotice = /^(?:\[!important\][.\s]*|important[.\s]+)?(?:automatic\s+)?review skipped[.:]?\s+(.+?)(?:[.!?](?:\s|$)|\s+(?:please|to trigger|trigger a|⚙)|$)/i.exec(text);
  if (skipNotice?.[1] !== undefined && skipNotice[1].trim() !== '') return skipNotice[1].trim();
  // Its failure notice, rewritten into the same summary over the last review's walkthrough: "Review failed" in a
  // caution alert, then why ("The pull request is closed", a merge mid-run). The alert's title or the heading's own
  // block end has to be there, so a sentence that merely opens on the words ("Review failed login attempts…") is not one.
  const failNotice = /^(?:(?:\[!caution\][.\s]*|caution[.\s]+)review failed[.:]?|review failed[.:])\s+(.+?)(?:[.!?](?:\s|$)|$)/i.exec(text);
  if (failNotice?.[1] !== undefined && failNotice[1].trim() !== '') return failNotice[1].trim();
  if (text.length > 400) return null;
  // "Skipping Bugbot: …", "Skipped review: …" — a skip of the run, not of something in the code under review.
  // "Macroscope skipped reviewing this pull request." names itself first; "Claude encountered an error" is a run that
  // broke, in the bot's own words — the sentence is the reason.
  const skipped =
    /^(?:[\w.-]+(?:\[bot\])?\s*[:,-]\s*)?skipp(?:ing|ed)\s+(?:[A-Z][\w.-]*(?:\[bot\])?\s*[:—–-]|(?:the\s+|this\s+)?(?:review|reviewing|pull request|pr|run|analysis|scan)\b)/i.test(text) ||
    /^[A-Z][\w.-]*(?:\[bot\])?\s+skipped\s+reviewing\b/i.test(text) ||
    /^[A-Z][\w.-]*(?:\[bot\])?\s+encountered an error\b/i.test(text);
  const sentences = text.split(/(?<=[.!?])\s+/);
  // Otherwise the sentence must say it about the bot or the review, not about the code: "is disabled" alone
  // describes a feature flag as readily as a bot, and a short review can say exactly that. The one exception is
  // a comment that is nothing but the refusal — "Permission denied.", "Unable to access repository." — a few
  // words with no subject before the phrase; a review of code names what it is about.
  const bare = sentences[0] !== undefined && isBareRefusal(sentences[0]) && (sentences.length === 1 || isBareAdvice(body, text)) ? sentences[0] : undefined;
  const first = skipped ? sentences[0] : (bare ?? sentences.find(isRefusalSentence));
  if (first === undefined) return null;
  // The first sentence, without the bot's own name as a prefix ("Skipping Bugbot: " → the explanation).
  const stripped = first.replace(/^skipp(?:ing|ed)\s+[\w.-]+(?:\[bot\])?\s*[:,-]\s*/i, '');
  return stripped.replace(/[.!?]\s*$/, '').trim() || first;
}

/**
 * A whole comment that is only the refusal: at most eight words, one
 * sentence, the refusal phrase where it begins (after an optional "Sorry," /
 * "Error:"), and nothing after the phrase but the words a refusal is made of
 * — "the private repository", "right now", "try again later", "token". A word
 * outside that vocabulary is a thing in the diff ("Cannot access foo from the
 * worker"), and the comment is a finding, not a refusal. Backticks were
 * stripped before this, so a quoted `token` is the word token: the vocabulary
 * decides, not the quoting.
 */
function isBareRefusal(sentence: string): boolean {
  const lead = sentence.replace(/^(?:sorry|error|warning|note|oops|failed)\s*[:,!.-]?\s*/i, '').trim();
  if (lead.split(/\s+/).length > 8) return false;
  const match = REFUSAL_PHRASE.exec(lead);
  if (match === null || match.index !== 0) return false;
  return onlyRefusalWords(lead.slice(match[0].length));
}

/** Nothing but the words a refusal is made of (`BARE_REFUSAL_WORDS`), or nothing at all. */
function onlyRefusalWords(text: string): boolean {
  const rest = text.replace(/[.!?,;:]+$/, '').trim();
  return rest === '' || rest.split(/\s+/).every((word) => BARE_REFUSAL_WORDS.has(word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/gi, '')));
}

/**
 * What may follow a bare refusal: a line or two of advice ("Check the token
 * and retry.", "Install the app for this organization.") — short, and with
 * nothing code-like anywhere in the comment: no code span, no path, no
 * identifier (an underscore, a dot inside a word, camelCase). A finding
 * about code carries one of those; a refusal has nothing to point at.
 */
function isBareAdvice(body: string, text: string): boolean {
  // A link is where the advice points ("Visit https://github.com/settings/installations"), not code — unless
  // it points at code: a file in a repository (`/blob/`, `/tree/`, a `#L12` line anchor) is a finding's evidence.
  if (SOURCE_LINK.test(body)) return false;
  const unlinked = text.replace(/https?:\/\/\S+/g, '');
  if (unlinked.length > 200 || /`/.test(body)) return false;
  // The raw body, not the cleaned text: the cleanup strips underscores as emphasis marks.
  const raw = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '');
  if (/(?:\w[\w-]*[./]\w|\b\w*_\w+\b|\b[a-z]+[A-Z]\w*\b)/.test(raw)) return false;
  // And each sentence after the refusal must read as advice — an instruction ("Check the token and retry"), a
  // link, or a statement about the setup the review needs that says nothing else: its subject a setup noun and
  // the rest refusal vocabulary ("The token currently lacks the required scopes"). A statement about the code
  // fails one or the other: "The new guard rejects every request because the role check is reversed" (a finding's
  // explanation under a "Permission denied:" heading) on its subject, "The new permissions now require an
  // administrator for every read, breaking existing member access" on its words.
  if (/https?:\/\//.test(text)) return true;
  return unlinked
    .split(/(?<=[.!?])\s+/)
    .slice(1)
    .every((sentence) => {
      if (sentence.trim() === '' || !STATEMENT_OPENER.test(sentence)) return true;
      const subject = SETUP_SUBJECT.exec(sentence);
      return subject !== null && onlyRefusalWords(sentence.slice(subject[0].length));
    });
}

/** A sentence that opens on a thing rather than an instruction: a determiner or a third-person pronoun. */
const STATEMENT_OPENER = /^\s*(?:the|this|that|these|those|an?|it|its|we|our|they|their|there|each|every|some|all|no|none|one)\b/i;
/**
 * A statement that is advice all the same: it is about the bot or the setup
 * the review needs — the bot or review itself ("The bot needs access to this
 * repository"), a credential ("The token must have the required scopes"), the
 * installation or account ("The app must be installed for this
 * organization"), billing, or a person with a say over them ("An
 * administrator must grant access") — as its subject, see `SETUP_SUBJECT`,
 * with nothing after the verb but refusal vocabulary (`isBareAdvice`). A
 * statement about the code has none of these for a subject ("The guard
 * should allow members but rejects every request") or says more than a
 * notice does ("The new permissions now require an administrator for every
 * read").
 */
const SETUP_NOUN = /\b(?:bot|reviewer|reviews?|tokens?|credentials?|permissions?|scopes?|access|installations?|app|account|repo(?:sitory)?|organi[sz]ations?|org|plan|subscription|trial|billing|credits?|quota|seats?|dashboard|settings|admin(?:istrator)?s?|owners?|maintainers?)\b/i;
/**
 * A statement whose subject is such a noun: the determiner, up to two words
 * of modifier, the noun, and then the predicate's verb ("The token must…",
 * "An administrator must…", "These credentials must…", "The newly generated
 * token must…", an adverb allowed between: "The token currently lacks…").
 * The verb is what makes the noun the subject: in "The guard
 * drops permissions on every request" the noun is the object, and the
 * sentence is the code's business — as is a setup noun anywhere further in
 * ("The guard rejects members because it checks the wrong permissions").
 */
const SETUP_SUBJECT = new RegExp(
  `^\\s*(?:the|this|that|these|those|an?|its|your|our)\\s+(?:[\\w-]+\\s+){0,2}${SETUP_NOUN.source.replace(/^\\b|\\b$/g, '')}\\s+(?:(?:\\w+ly|still|now|also|already|no longer|not yet)\\s+)?(?:must|should|needs?|has|have|had|is|are|was|were|will|would|can|could|may|might|does|do|did|lacks?|requires?|expired|belongs?)\\b`,
  'i',
);

/**
 * A sentence that refuses: it holds a refusal phrase, and it is about the bot
 * or its review, the reader, or their repository — not about something in the
 * diff. A money word ("credits", "quota", "billing") is a subject only when it
 * is what the phrase itself is about ("no credits remaining", "insufficient
 * quota", "Billing is not configured"): "cannot run quota migrations" and "the
 * billing worker retries after the customer has reached their usage limit"
 * are findings.
 */
function isRefusalSentence(sentence: string): boolean {
  const match = REFUSAL_PHRASE.exec(sentence);
  if (match === null) return false;
  if (REFUSAL_SUBJECT.test(sentence) || REFUSAL_MONEY.test(match[0])) return true;
  // Or the money word is what the phrase is said of — the word right before it: "Billing is not configured",
  // "Credits are unavailable for this run" — not a modifier further back ("the billing worker … has reached their
  // usage limit"), and with nothing after the phrase but refusal vocabulary: "Credits are unavailable because the
  // new query excludes paid users" is about the code.
  const before = sentence.slice(0, match.index).trim().split(/\s+/);
  if (!REFUSAL_MONEY.test(before[before.length - 1] ?? '')) return false;
  return onlyRefusalWords(sentence.slice(match.index + match[0].length));
}

/**
 * A URL into a repository's files: `/blob/<ref>/…`, `/tree/<ref>/…`, a pull
 * request's `/pull/<n>/files` or `/changes` diff page, or a `#L<n>` line
 * anchor. Shaped to GitHub's paths, so a docs page that happens to say
 * `/changes/` in its path is still a link, not code.
 */
const SOURCE_LINK = /https?:\/\/\S*(?:\/(?:blob|tree)\/\S+|\/pull\/\d+\/(?:files|changes)(?:[/?#]|$)|#L\d+(?:[-C]L?\d+)*[.,;:)\]]*(?:\s|$))/;

/** Words that may follow a bare refusal's phrase without making it about the code. */
const BARE_REFUSAL_WORDS = new Set([
  'the', 'this', 'that', 'it', 'your', 'our', 'a', 'an', 'to', 'of', 'for', 'on', 'in', 'at', 'by', 'and', 'or', 'with', 'from', 'is', 'was',
  'repository', 'repositories', 'repo', 'repos', 'pull', 'request', 'pr', 'branch', 'commit', 'commits', 'code', 'changes', 'diff', 'files', 'source', 'contents',
  'private', 'public', 'protected', 'archived', 'remote', 'upstream', 'forked', 'fork', 'base', 'head', 'target', 'default',
  'installation', 'app', 'github', 'token', 'tokens', 'credentials', 'key', 'secret', 'permission', 'permissions', 'access', 'scope', 'scopes', 'rights',
  'account', 'organization', 'org', 'team', 'workspace', 'project', 'plan', 'subscription', 'trial', 'quota', 'limit', 'credits', 'usage', 'seats', 'settings', 'dashboard',
  'remaining', 'left', 'available', 'exceeded', 'expired', 'invalid', 'missing', 'required', 'needed', 'right', 'now', 'currently', 'moment', 'time',
  'please', 'try', 'again', 'later', 'contact', 'support', 'enable', 'install', 'upgrade', 'run', 'review',
  'integration', 'billing', 'payment', 'method', 'cycle', 'period', 'month', 'until', 'next', 'before', 'after', 'once', 'when',
  'be', 'been', 'has', 'have', 'not', 'no', 'longer', 'yet', 'grant', 'granted', 'granting', 'retry', 'retrying', 'installed', 'configured', 'enabled', 'authorized', 'authorised', 'reconnect', 'renew', 'renewed', 'valid', 'correct', 'read', 'write',
  '',
]);

/** What a bot says when it will not run. */
const REFUSAL_PHRASE = new RegExp(
  [
    /\b(?:is|are|was|has been|have been)\s+(?:currently\s+)?(?:disabled|not enabled|not installed|not configured|not set up|not authori[sz]ed|unavailable|turned off|paused)\b/,
    /\b(?:no|out of|insufficient|exceeded|reached|used(?: up)?|exhausted)\s+(?:your\s+)?(?:\w+\s+){0,2}(?:credits?|quota|budget|limit|allowance)\b/,
    /\b(?:larger|bigger|longer)\s+than\s+(?:the|our|your)\s+(?:\w+\s+)?limit\b/,
    /\b(?:don.t|do not|won.t|will not)\s+review\s+(?:pull requests|prs|changes)\b/,
    /\b(?:usage|rate|quota|spend(?:ing)?)\s+limits?\s+(?:(?:(?:has|have)\s+been|was|were)\s+)?(?:reached|exceeded|hit)\b/,
    /\b(?:has|have|had)\s+(?:reached|exceeded|hit)\s+(?:its|their|the|a|your)\s+(?:\w+\s+)?(?:usage|rate|quota|spend(?:ing)?)\s+limits?\b/,
    /\b(?:subscription|plan|trial|billing)\b[^.!?]*\b(?:expired|required|needed|inactive|ended|lapsed|upgrade)\b/,
    /\b(?:could not|couldn.t|cannot|can.t|unable to|failed to)\s+(?:access|read|clone|fetch|start|run|review|analy[sz]e)\b/,
    /\b(?:permission denied|access denied|not authorized|unauthorized|forbidden)\b/,
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
);

/**
 * The sentence is about the bot or its review — a bot's name, "the review" /
 * "to review" / "code reviews", "this repository", "your account", credits —
 * rather than about something in the diff. "review" alone is not enough:
 * "Cannot run review tests on a fresh checkout" is about the code. A review
 * bot's own login or title is one of these; so is the second person, since
 * a refusal addresses the reader ("You have no credits"). The money words
 * are not (`REFUSAL_MONEY`): "billing" names a worker as readily as a bill.
 */
const REFUSAL_SUBJECT = new RegExp(
  [
    /\b(?:bot|reviewer|reviewing|code reviews?|analysis|scan)\b/,
    /\b(?:this|the|its|my|your|an?|automated|ai|pr|pull request)\s+reviews?\b/,
    /\b(?:to|cannot|can.t|could not|couldn.t|unable to|failed to|will not|won.t|don.t|do not)\s+review\b/,
    /\b(?:this|the|your)\s+(?:repo(?:sitory)?|org(?:anization)?|account|project|workspace|team|installation|app|plan|subscription|trial)\b/,
    /\byou(?:r)?\b/,
    /\[bot\]/,
    // A bot's title or login stem — except a title that is a plain lowercase word ("cubic"): "the cubic interpolation
    // worker cannot run" is about the code; the login stem (`cubic-dev-ai`) still names the bot.
    new RegExp(`\\b(?:${REVIEW_BOTS.flatMap((bot) => [...(/^[a-z]+$/.test(bot.title) ? [] : [bot.title]), ...bot.logins.map((login) => login.replace(/\[bot\]$/i, ''))]).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`),
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
);
/**
 * Whether lowercase `text` names a review bot: a title, or a login's stem —
 * except a title that is a plain lowercase word ("cubic"), which is as often
 * the word ("cubic interpolation") as the bot; its login stem still names it.
 */
function botNamedIn(text: string): boolean {
  return REVIEW_BOTS.some((bot) => (!/^[a-z]+$/.test(bot.title) && text.includes(bot.title.toLowerCase())) || bot.logins.some((login) => text.includes(login.replace(/\[bot\]$/, '').toLowerCase())));
}

/** The money words: a subject only inside the refusal phrase itself ("no credits remaining"), see `isRefusalSentence`. */
const REFUSAL_MONEY = /\b(?:credits?|quota|billing|seats?)\b/i;

function withOptionalCount(base: DerivedBotVerdict, parsed: ParsedBotBody): DerivedBotVerdict {
  return {
    ...base,
    ...(parsed.count !== null ? { count: parsed.count } : {}),
    ...(parsed.score !== null ? { score: parsed.score } : {}),
    ...(parsed.severity !== null ? { severity: parsed.severity } : {}),
  };
}

/** A registered review bot, or one the user listed; any other `[bot]` (deploy previews, CI) is not a reviewer. */
function reviewBotIdFor(login: string, extraLogins: readonly string[]): string | null {
  const known = botByLogin(login);
  if (known !== null) return known.id;
  return extraLogins.some((entry) => entry.toLowerCase() === login.toLowerCase()) ? `custom:${login.toLowerCase()}` : null;
}

/**
 * A bot comment that only says a run began or is under way ("Starting Devin
 * Review.", "Bugbot is reviewing your changes", "Review in progress"): a
 * status line, never a verdict. Short, one sentence, and shaped like one.
 */
/**
 * CodeRabbit's answer to a command (`@coderabbitai review`, `resume`): "✅ Action performed" in a disclosure, then what
 * it did, edited in place from "Review triggered." to "Review finished." — the second with "does not re-review already
 * reviewed commits" when there was nothing new, or "⚠️ Action not completed" with why (the last commit already
 * reviewed). `started` is a run under way; `done` answers the request and reviews
 * nothing, so the run before it stands (geld#68 read the inherited count of a resolved finding as "1 issue").
 */
export function commandReply(body: string): 'started' | 'done' | null {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "⚠️ Action not completed" ("Already reviewed the last commit", geld#114) answers the request with no review just the same.
  if (!/^[^\p{L}\p{N}]*actions? (?:performed|not completed)\b/iu.test(text)) return null;
  return /\breviews? triggered\b/i.test(text) ? 'started' : 'done';
}

export function isStatusLineComment(body: string): boolean {
  if (commandReply(body) === 'started') return true;
  const untagged = body
    .replace(/<!--[\s\S]*?-->/g, '')
    // Qodo's "<h3>Qodo is busy working</h3>" is HTML, raw.
    .replace(/<[^>]+>/g, ' ');
  // Claude Code's progress comment: "Reviewing PR #396" on a line of its own (a spinner image beside it, raw), then
  // the checklist it ticks as it goes — "- [x] Gather context" raw, bare "Gather context" lines as the page reads a
  // task list (`blockText` keeps no checkbox). The first line alone says it, whatever the length of the list below.
  const firstLine = untagged.split('\n').find((line) => line.trim() !== '') ?? '';
  if (/^\s*reviewing (?:pr|pull request) #?\d+\s*$/i.test(firstLine.replace(/[`*_>~#]/g, ' ').replace(/\s+/g, ' '))) return true;
  const text = untagged
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return false;
  const sentences = text.split(/(?<=[.!…])\s+/).filter((part) => part !== '');
  // CodeRabbit's "Currently processing new changes in this PR. This may take a few minutes, please wait..." sits in
  // a note above its run configuration, so the comment is long; its first sentence is the status line — behind
  // "[!NOTE]" in the markdown, behind the "Note" heading GitHub renders it as on the page (`blockText` keeps it,
  // on its own line, no full stop). The whole first sentence must be that line: one that merely begins with the
  // words ("Currently processing changes this way is slow. Found 2 issues…") is a review, not a status.
  // Qodo's "Qodo is busy working. Check back in a few minutes." is a status line whatever its length.
  if (/^(?:[\w.-]+\s+)?is busy working\b/i.test(text)) return true;
  if (text.length > 240 || sentences.length > 2) return /^(?:\[!note\]\s*|note\s+)?currently processing (?:new )?changes in this (?:pr|pull request)[.!…]?$/i.test(sentences[0] ?? '');
  // The verb of a run under way, with what it is running on named in the same sentence ("Starting Devin Review.",
  // "Bugbot is reviewing your changes"), never a sentence that merely begins with such a word ("Starting from line 12, …").
  const underWay = /^(?:[\w.-]+(?:\[bot\])?\s+)?(?:is\s+)?(?:now\s+)?(?:starting|started|beginning|kicking off|running|reviewing|analy[sz]ing|looking (?:at|into|over)|working on|scanning|checking)\b[^.!…]*\b(?:review|analysis|scan|changes|pull request|pr|code|diff|your|this)\b/i;
  // A sentence that reports what was found is a report, however it opens ("Reviewing PR #396 revealed 2 bugs").
  if (/\b\d+\s+(?:\w+\s+)?(?:issues?|bugs?|findings?|problems?)\b|\b(?:found|revealed|flagged)\b/i.test(text)) return false;
  const stated = /^(?:review|analysis|scan)\s+(?:in progress|started|queued|has started)\b/i;
  const promise = /\b(?:will|I'?ll)\s+(?:post|comment|report|reply|start|begin|review)\b.*\b(?:when|once|shortly|soon)\b/i;
  return underWay.test(text) || stated.test(text) || promise.test(text);
}

export interface BotComment {
  readonly author: string;
  readonly body: string;
  readonly anchor: string;
  /**
   * Set on a review thread the bot opened: whether someone has resolved it.
   * Absent for its comments and review bodies.
   */
  readonly resolved?: boolean;
  /** When it was posted, ISO; lets a status line age (see `STATUS_LINE_STALE_MS`). */
  readonly createdAt?: string;
  /**
   * Who reacted to it, by login, when the reader of the page knows. A bot
   * that acknowledges a trigger with a reaction (`ReviewBot.acknowledges`)
   * is running once its login is here; without it, past `ACK_GRACE_MS`,
   * the trigger was never picked up.
   */
  readonly reactedBy?: readonly string[];
  /**
   * When it was last edited, ISO, when the reader of the page knows. A bot
   * that reports a re-run by rewriting its summary in place (Greptile's
   * "Reviews (2)", a new confidence score) posts nothing new, so the edit is
   * the only sign the run it was asked for has ended.
   */
  readonly editedAt?: string;
}

/**
 * A run announced this long ago that has said nothing since, with no check
 * to report how it ended, is not running: the bot never reported (Devin's
 * second "Starting Devin Review." on a push, then silence for days). The
 * longest reviews seen take a quarter of this.
 */
export const STATUS_LINE_STALE_MS = 45 * 60 * 1000;

/** A bot's review threads since it last summarised a run: a finding each, open until resolved. */
interface ThreadRun {
  readonly login: string;
  readonly open: number;
  /** Where the reader should go: the first thread still open, else the last one. */
  readonly openAnchor: string | null;
  readonly lastAnchor: string;
  /** When the latest of these threads was posted (epoch ms), when known. */
  readonly lastAt: number | null;
}

/**
 * A bot that reports a re-run by rewriting its summary posts its threads
 * and that rewrite seconds apart (Greptile's summary says "Reviews (2)"
 * moments after its threads land, and fills in while they do). A rewrite
 * this long after the run's last thread is not that run's touch-up: it is
 * the report of a later run that found nothing new, and the bot's latest
 * word.
 */
export const RERUN_EDIT_GAP_MS = 5 * 60 * 1000;

/**
 * Combine check-run conclusions with the bot's own comments. A green check
 * with "no issues" is `clean`; a completed check plus findings in comments is
 * `findings`; an in-progress check is `running`. A comment that only says
 * the run started does not vote: a bot whose check finished green and that
 * flagged nothing since is `clean` (Devin says it is looking and then says
 * nothing more when all is well); with no check to go by, such a bot is
 * `running` until it says more.
 *
 * A review thread the bot opened is a finding whatever its wording, and it
 * stays one only until someone resolves it: a run whose threads are all
 * resolved has nothing outstanding, so it reads `findings` with `count: 0`
 * ("resolved") — a check that failed or still runs says so instead, one that
 * passed does not make it a run that found nothing. Threads posted before
 * the bot's next summary comment belong to the run that summary reports on,
 * and a summary rewritten `RERUN_EDIT_GAP_MS` after a run's last thread
 * reports a later run — the bot's latest word, with all threads resolved.
 * A request for a bot counts whoever posts it, another bot included.
 */
export interface VerdictOptions {
  /**
   * The comments are not all of them yet (the page is still reading its
   * timeline). An old request for a bot with nothing from the bot after it is
   * then `loading`, not `failed`: the bot's answer may simply not be here yet.
   */
  readonly partial?: boolean;
  /**
   * The pull request is merged or closed. GitHub then shows none of the
   * checks that ran on it, so a request the bot never answered in a comment
   * is no word either way: `unknown`, not `failed` — the run may well have
   * passed as a check the reader can no longer see.
   */
  readonly closed?: boolean;
}

export function verdictsFrom(
  checks: readonly RawCheckRun[],
  comments: readonly BotComment[],
  headSha: string,
  extraLogins: readonly string[] = [],
  now: number = Date.now(),
  options: VerdictOptions = {},
): readonly DerivedBotVerdict[] {
  const byId = new Map<string, DerivedBotVerdict>();
  /**
   * What each bot's check alone said, for a run its comments have not spoken about. `findings` is a neutral
   * conclusion from a bot whose word that is for a run that found something (Bugbot), with no count until its
   * threads give one.
   */
  const checkVerdict = new Map<string, 'clean' | 'findings' | 'failed' | 'running'>();
  /** When each bot's check began (epoch ms), when the page or the API said: which run a finished check belongs to. */
  const checkStartedAt = new Map<string, number>();
  /** When each bot's check finished (epoch ms), when known: places the run only when its start is unknown (a commit status). */
  const checkFinishedAt = new Map<string, number>();

  for (const check of checks) {
    const bot = botByCheckName(check.name);
    if (bot === null) continue;
    const login = bot.logins[0] ?? bot.id;
    const running = check.status !== 'completed';
    const failed = check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled' || check.conclusion === 'action_required' || check.conclusion === 'stale';
    // A skipped check is a run the bot did not make; its row is the word on that, as a "Review skipped" comment is.
    const skipped = check.conclusion === 'skipped';
    // `neutral` is the bot's own word: findings for one whose docs say so (Bugbot), else a run with nothing to say.
    const neutralFindings = check.conclusion === 'neutral' && bot.neutralConclusion === 'findings';
    const verdict = running ? 'running' : failed || skipped ? 'failed' : neutralFindings ? 'findings' : 'clean';
    checkVerdict.set(bot.id, verdict);
    // The start goes with the verdict: a later check for the same bot with no start of its own must not keep
    // the earlier one's, or its verdict would be read as the earlier run's below.
    const started = check.startedAt === undefined ? NaN : Date.parse(check.startedAt);
    if (Number.isNaN(started)) checkStartedAt.delete(bot.id);
    else checkStartedAt.set(bot.id, started);
    const finished = check.completedAt === undefined ? NaN : Date.parse(check.completedAt);
    if (Number.isNaN(finished)) checkFinishedAt.delete(bot.id);
    else checkFinishedAt.set(bot.id, finished);
    const record: DerivedBotVerdict = {
      id: bot.id,
      login,
      verdict,
      reviewedSha: check.sha || headSha,
      checkName: check.name,
      ...(skipped ? { reason: 'Check skipped' } : {}),
    };
    byId.set(bot.id, record);
  }

  /** Bots whose latest comment so far is a status line (the run it announced has not reported), with that line. */
  /**
   * `own`: the line is the bot's ("Currently processing…"), not a person's request. `acknowledged`: the bot said it
   * took the request (Greptile's 👀) — the one case where its silence afterwards is the run's failure rather than
   * no word at all.
   */
  const statusOnly = new Map<string, { readonly login: string; readonly anchor: string; readonly at: number | null; readonly own: boolean; readonly acknowledged: boolean }>();
  const threadRuns = new Map<string, ThreadRun>();
  /** The thread run a request set aside, in case the request is refused and that run is still the bot's last real one. */
  const runsBeforeAsk = new Map<string, ThreadRun>();
  /** When each bot last rewrote one of its comments: a summary edited after a run was asked for is that run's report. */
  const lastEditBy = new Map<string, number>();
  /** When each comment was last rewritten, by anchor: the summary a verdict was read from has an edit of its own. */
  const editedAtOf = new Map<string, number>();
  /** The summaries whose own words gave a count, by anchor: a later uncounted summary inherits the number, not the reading. */
  const countedSummaries = new Set<string>();
  /**
   * When each bot last reported: a comment that votes below (a thread, a refusal, a review-shaped summary) posted
   * or rewritten. Its "Starting" lines and a coding agent's conversational replies are not reports.
   */
  const lastWordBy = new Map<string, number>();
  /** When each bot last refused, posted or rewritten: a run its check still shows under way may be the one it gave up. */
  const refusedAt = new Map<string, number>();
  /**
   * Requests a bot answered with no review ("Review finished"): when it was asked, when the answer was last written, and
   * whether that time is its rewrite (the run's finish) or only its first posting. A check that ran for that request ends
   * with nothing new, so the run the request set aside stands over its conclusion.
   */
  const answeredBy = new Map<string, { readonly askedAt: number; readonly at: number; readonly finished: boolean; readonly anchor: string }>();
  /**
   * Bots whose running check a refusal ended, with the commit that check ran on: their verdict is judged, as one read
   * against a finished check is, and an earlier review standing in it is not of that commit.
   */
  const refusedRuns = new Map<string, string>();
  /**
   * Whether a check begun at `started` is the run of a request the bot answered with "Review finished": begun after the
   * request and before the answer's rewrite (the run's finish), or, with that rewrite not known yet, within the report's
   * grace of the answer's first posting, since the bot posts the answer moments before it starts the check; and the bot
   * has voted nothing since. A check begun after that is a newer run (one started on the bot's own site, say).
   */
  /**
   * What an answered request leaves: the run it set aside, or, for a bot with none (a summary, a review, threads), no
   * word at all — the check that ran for it is all its record holds, and "clean" or "running" from that check would
   * claim a review the reply says did not happen. It opens the reply.
   */
  const afterAnswer = (record: DerivedBotVerdict): DerivedBotVerdict => {
    const answer = answeredBy.get(record.id);
    if (record.sourceId !== undefined || answer === undefined) return record;
    return { id: record.id, login: record.login, verdict: 'unknown', reviewedSha: record.reviewedSha, ...(record.checkName === undefined ? {} : { checkName: record.checkName }), sourceId: answer.anchor };
  };
  const ranForAnswer = (id: string, started: number): boolean => {
    const answer = answeredBy.get(id);
    if (answer === undefined || started < answer.askedAt || started > (answer.finished ? answer.at : answer.at + REPORT_GRACE_MS)) return false;
    return (lastWordBy.get(id) ?? Number.NEGATIVE_INFINITY) <= answer.at;
  };
  const reported = (id: string, comment: BotComment): void => {
    for (const at of [comment.createdAt, comment.editedAt]) {
      const time = at === undefined ? NaN : Date.parse(at);
      if (!Number.isNaN(time) && time > (lastWordBy.get(id) ?? Number.NEGATIVE_INFINITY)) lastWordBy.set(id, time);
    }
  };
  for (const comment of comments) {
    const id = reviewBotIdFor(comment.author, extraLogins);
    if (id !== null && comment.editedAt !== undefined) {
      const edited = Date.parse(comment.editedAt);
      if (!Number.isNaN(edited)) {
        editedAtOf.set(comment.anchor, edited);
        if (edited > (lastEditBy.get(id) ?? Number.NEGATIVE_INFINITY)) lastEditBy.set(id, edited);
      }
    }
    // Asking a bot to run ("bugbot run", "@greptileai") starts a run as surely as the bot's own "Starting" line
    // does: that bot is running until it speaks (or the line ages, or its check says). A person asks; so does a
    // bot — a coding agent's "@greptileai" (Cursor's agents post as `cursor[bot]`, Bugbot's own login) asks
    // Greptile just the same, though never itself: a bot's own trigger phrase in its own words is not a request.
    if (comment.resolved === undefined && isTriggerComment(comment.body, extraLogins)) {
      const at = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
      for (const asked of botsTriggeredBy(comment.body, extraLogins)) {
        if (asked.id === id) continue;
        // A bot that reacts when it takes a trigger, and has not after the grace: it never saw this one.
        if (!Number.isNaN(at) && now - at > ACK_GRACE_MS && botById(asked.id)?.acknowledges === 'reaction' && !reactedBy(comment, asked.id)) continue;
        // The threads set aside here are what a refusal brings back. Only a report from the bot clears the
        // stash (below): a second request, or the bot's own "Starting", before any report leaves it the last
        // real run.
        const prior = threadRuns.get(asked.id);
        if (prior !== undefined) runsBeforeAsk.set(asked.id, prior);
        threadRuns.delete(asked.id);
        statusOnly.set(asked.id, { login: asked.login, anchor: comment.anchor, at: Number.isNaN(at) ? null : at, own: false, acknowledged: botById(asked.id)?.acknowledges === 'reaction' && reactedBy(comment, asked.id) });
      }
      continue;
    }
    if (id === null) continue;
    if (comment.resolved !== undefined) {
      // The run the bot announced has reported: its findings are these threads.
      reported(id, comment);
      statusOnly.delete(id);
      runsBeforeAsk.delete(id);
      const run = threadRuns.get(id);
      const open = (run?.open ?? 0) + (comment.resolved ? 0 : 1);
      const openAnchor = run?.openAnchor ?? (comment.resolved ? null : comment.anchor);
      const at = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
      const lastAt = Number.isNaN(at) ? (run?.lastAt ?? null) : Math.max(at, run?.lastAt ?? Number.NEGATIVE_INFINITY);
      threadRuns.set(id, { login: comment.author, open, openAnchor, lastAnchor: comment.anchor, lastAt });
      continue;
    }
    if (commandReply(comment.body) === 'done') {
      // The request is answered with no review: the run it set aside is still the bot's last, threads and all.
      const posted = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
      const rewritten = comment.editedAt === undefined ? NaN : Date.parse(comment.editedAt);
      const at = Number.isNaN(rewritten) ? posted : Math.max(rewritten, Number.isNaN(posted) ? rewritten : posted);
      if (!Number.isNaN(at)) answeredBy.set(id, { askedAt: statusOnly.get(id)?.at ?? (Number.isNaN(posted) ? at : posted), at, finished: !Number.isNaN(rewritten), anchor: comment.anchor });
      statusOnly.delete(id);
      const prior = runsBeforeAsk.get(id);
      if (!threadRuns.has(id) && prior !== undefined) threadRuns.set(id, prior);
      runsBeforeAsk.delete(id);
      continue;
    }
    const refusal = refusalReason(comment.body);
    if (refusal !== null) {
      reported(id, comment);
      for (const at of [comment.createdAt, comment.editedAt]) {
        const time = at === undefined ? NaN : Date.parse(at);
        if (!Number.isNaN(time) && time > (refusedAt.get(id) ?? Number.NEGATIVE_INFINITY)) refusedAt.set(id, time);
      }
      // The bot said it would not review: the run that was asked for is answered (not running), and refused. A
      // review the bot did make earlier still stands — the chip shows the last real run, and `reviewedSha` says
      // whether it is behind the head — so the refusal is the verdict only for a bot that never reviewed here.
      statusOnly.delete(id);
      const existing = byId.get(id);
      const prior = runsBeforeAsk.get(id);
      if (!threadRuns.has(id) && prior !== undefined) threadRuns.set(id, prior);
      const reviewed = threadRuns.has(id) || (existing?.sourceId !== undefined && (existing.verdict === 'clean' || existing.verdict === 'findings'));
      if (reviewed) continue;
      byId.set(id, { id, login: comment.author, verdict: 'failed', reviewedSha: headSha, ...(existing?.checkName === undefined ? {} : { checkName: existing.checkName }), sourceId: comment.anchor, reason: refusal });
      continue;
    }
    if (isStatusLineComment(comment.body)) {
      // A new run began: the threads so far belong to the run before it — and are what a refusal of this run
      // brings back, as with a request.
      const prior = threadRuns.get(id);
      if (prior !== undefined) runsBeforeAsk.set(id, prior);
      threadRuns.delete(id);
      const at = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
      statusOnly.set(id, { login: comment.author, anchor: comment.anchor, at: Number.isNaN(at) ? null : at, own: true, acknowledged: false });
      continue;
    }
    const parsed = parseBotBody(comment.body, id.startsWith('custom:') ? '' : id);
    // A coding agent's reply to a person or to another bot is not its review; only a review-shaped comment votes.
    if (botById(id)?.conversational === true && !isReviewShaped(parsed)) continue;
    reported(id, comment);
    if (parsed.count !== null) countedSummaries.add(comment.anchor);
    threadRuns.delete(id);
    statusOnly.delete(id);
    // The bot reported: whatever a request set aside is an older run now, not what a later refusal brings back.
    runsBeforeAsk.delete(id);
    const existing = byId.get(id);
    const login = comment.author;
    if (existing !== undefined) {
      const verdict = parsed.clean && existing.verdict === 'failed' ? 'findings' : parsed.clean ? 'clean' : parsed.count === 0 ? 'clean' : 'findings';
      // A clean run says nothing about counts: the earlier run's number and severity belong to that run, not this one.
      const base: DerivedBotVerdict =
        verdict === 'clean' ? { id: existing.id, login, verdict, reviewedSha: existing.reviewedSha, ...(existing.checkName === undefined ? {} : { checkName: existing.checkName }) } : existing;
      byId.set(id, withOptionalCount({ ...base, verdict, sourceId: comment.anchor, login }, parsed));
      continue;
    }
    const verdict = parsed.clean ? 'clean' : 'findings';
    byId.set(id, withOptionalCount({ id, login, verdict, reviewedSha: headSha, sourceId: comment.anchor }, parsed));
  }
  // A check left under way by a run the bot gave up on: CodeRabbit rewrites its summary into "Review failed · The pull
  // request is closed" when a merge lands mid-run and never closes its commit status (geld#103), so the check alone
  // would read running for good. The refusal must be the bot's latest word and newer than the check's start; a commit
  // status carries no start, and then only a closed pull request, where no new run can begin, lets it end the run.
  for (const [id, verdict] of checkVerdict) {
    const refused = refusedAt.get(id);
    if (verdict !== 'running' || refused === undefined || refused < (lastWordBy.get(id) ?? Number.NEGATIVE_INFINITY)) continue;
    const started = checkStartedAt.get(id);
    if (started !== undefined ? refused > started : options.closed === true) {
      checkVerdict.delete(id);
      refusedRuns.set(id, byId.get(id)?.reviewedSha ?? headSha);
    }
  }
  // A check still under way for a request the bot answered with "Review finished": nothing new is coming, so the run
  // the request set aside stands while the check closes, rather than reading running for as long as it stays open. Only
  // with a start to place it by; a check begun after the answer is a newer run and reads running as any other.
  for (const [id, verdict] of checkVerdict) {
    const started = checkStartedAt.get(id);
    if (verdict !== 'running' || started === undefined || !ranForAnswer(id, started)) continue;
    checkVerdict.delete(id);
    const record = byId.get(id);
    if (record !== undefined) byId.set(id, afterAnswer(record));
  }
  // A bot whose latest word is "starting" has a run under way or just finished: what it found before belongs to
  // an earlier run (those threads are items in their own right). The check says how this run ended; with no
  // check to go by the bot is running until it says more.
  for (const [id, { login, anchor, at, own, acknowledged }] of statusOnly) {
    const existing = byId.get(id);
    // The bot rewrote its summary after the run was asked for: that is the report, and the summary's verdict (read
    // above, from its words as they are now) stands. Greptile re-reviews into the same comment.
    const edited = lastEditBy.get(id);
    if (existing !== undefined && at !== null && edited !== undefined && edited > at) continue;
    // Announced long ago, nothing since, no check to say how it went: the run never reported. What the bot said
    // before that stands (from that earlier run); a bot that never said anything else did not review this.
    const stale = at !== null && now - at > STATUS_LINE_STALE_MS;
    // The check speaks for this run only when it is this run's: one that began — or, with no start known, finished
    // (a commit status is set in one moment) — before the request is the earlier run's, and says nothing about
    // whether the bot answered. With no times to go by, the check is taken as the run's, as before: Devin's status
    // on the page carries none, flips to pending as it starts and back to green with no comment when it finds
    // nothing (mint#12256), so an undated green check after "Starting" is that clean run.
    const started = checkStartedAt.get(id);
    const finished = checkFinishedAt.get(id);
    const before = started !== undefined ? started : finished;
    const checkIsThisRun = existing?.checkName !== undefined && !(before !== undefined && at !== null && before < at);
    // A request that aged unanswered, with no check of its own to say how the run went: the earlier run stands
    // whole, its threads included — the request had set them aside — so a run whose findings were all resolved
    // reads "resolved" below, not as its summary's count from before they were, and a bot that only ever posted
    // threads keeps them rather than reading as failed (mint#12803: a "bugbot run" Bugbot never answered left the
    // chip amber over one resolved thread). Not while the timeline is still being read: the answer may simply not
    // have loaded yet, and the earlier findings are not final until it has.
    if (stale && !checkIsThisRun && options.partial !== true) {
      const prior = runsBeforeAsk.get(id);
      if (prior !== undefined && !threadRuns.has(id)) {
        threadRuns.set(id, prior);
        continue;
      }
    }
    if (existing === undefined) {
      // With the timeline still loading, an old request and silence is not yet a verdict on the bot. Otherwise the
      // silence is no word at all — `unknown`, grey — unless the bot acknowledged the request (Greptile's 👀) and
      // then never reported: it said it had taken the run, so that silence is the run's failure. A request the bot
      // never acknowledged says nothing about whether it saw it (Bugbot acknowledges nothing, and skips drafts by
      // default: six "bugbot run" on mint#12998, a draft, went unanswered and read red), on a closed pull request
      // the checks of the time are gone, and the bot's own "Currently processing…" left standing is CodeRabbit
      // deciding not to review (geld#57). A failed check or a refusal still says failed/skipped in so many words.
      const silence = options.partial === true ? 'loading' : options.closed !== true && !own && acknowledged ? 'failed' : 'unknown';
      byId.set(id, { id, login, verdict: stale ? silence : 'running', reviewedSha: headSha, sourceId: anchor });
      continue;
    }
    if (!checkIsThisRun) {
      if (!stale) byId.set(id, { id, login, verdict: 'running', reviewedSha: existing.reviewedSha, ...(existing.checkName === undefined ? {} : { checkName: existing.checkName }), sourceId: anchor });
      continue;
    }
    const fromCheck = checkVerdict.get(id) ?? 'running';
    byId.set(id, { id, login, verdict: fromCheck, reviewedSha: existing.reviewedSha, ...(existing.checkName === undefined ? {} : { checkName: existing.checkName }), sourceId: anchor });
  }
  // The bot's latest word is a set of review threads: the ones still open are its outstanding findings. With
  // every one resolved nothing is outstanding, and the check (when there is one) says how that run ended.
  for (const [id, run] of threadRuns) {
    const existing = byId.get(id);
    const reviewedSha = existing?.reviewedSha ?? headSha;
    const checkName = existing?.checkName;
    const named = checkName === undefined ? {} : { checkName };
    // The run's summary scored the pull request (Greptile's N/5): that stays with the run, open threads or not.
    const scored = existing?.verdict === 'findings' && existing.score !== undefined ? { score: existing.score } : {};
    if (run.open > 0) {
      const severity = existing?.verdict === 'findings' && existing.severity !== undefined ? { severity: existing.severity } : {};
      byId.set(id, { id, login: run.login, verdict: 'findings', count: run.open, ...scored, ...severity, reviewedSha, ...named, sourceId: run.openAnchor ?? run.lastAnchor });
      continue;
    }
    // Every thread resolved, and the bot rewrote its summary well after the last of them: that rewrite reports a
    // later run with nothing new to say (Greptile re-reviews into the same comment), so it is the bot's latest word
    // — its verdict, read above from the words as they are now, and its anchor, where the reader should go. The
    // rewrite has to be that summary's own: a bot with two summaries editing the older one says nothing new in the
    // one the verdict was read from.
    // A rewrite whose own words gave no count (findings the parser could not count) says less than the threads do:
    // every one of them is resolved, and that is what the chip shows. A rewrite that counts its findings still stands
    // — counted by that summary, not a number an earlier summary left on the record.
    const edited = existing?.sourceId === undefined ? undefined : editedAtOf.get(existing.sourceId);
    const rewriteSpeaks = existing?.verdict === 'clean' || (existing?.verdict === 'findings' && existing.sourceId !== undefined && countedSummaries.has(existing.sourceId));
    if (existing?.sourceId !== undefined && rewriteSpeaks && edited !== undefined && run.lastAt !== null && edited > run.lastAt + RERUN_EDIT_GAP_MS) continue;
    // A check that failed or is still running says so; one that passed does not turn resolved findings into a run
    // that found nothing — the bot has not looked again — so they read "resolved" (findings, none open), which
    // the request menu still offers a rerun for.
    // ...and a neutral that means findings says the run found these threads, which are resolved: "resolved" too.
    const fromCheck = checkName === undefined ? null : checkVerdict.get(id) ?? null;
    if (fromCheck !== null && fromCheck !== 'clean' && fromCheck !== 'findings') {
      byId.set(id, { id, login: run.login, verdict: fromCheck, reviewedSha, ...named, sourceId: run.lastAnchor });
      continue;
    }
    byId.set(id, { id, login: run.login, verdict: 'findings', count: 0, ...scored, reviewedSha, ...named, sourceId: run.lastAnchor });
  }
  // A check still running on the head is the bot's current run, whatever its comments said: those are the run
  // before (a bot run from CI, or asked for on its own site, posts nothing until it is done). The chip reads
  // running and keeps the latest summary to open.
  for (const [id, verdict] of checkVerdict) {
    if (verdict !== 'running') continue;
    const existing = byId.get(id);
    if (existing === undefined || existing.verdict === 'running' || existing.verdict === 'loading') continue;
    byId.set(id, {
      id,
      login: existing.login,
      verdict: 'running',
      reviewedSha: existing.reviewedSha,
      ...(existing.checkName === undefined ? {} : { checkName: existing.checkName }),
      ...(existing.sourceId === undefined ? {} : { sourceId: existing.sourceId }),
    });
  }
  // A check that finished, whose start is known: its report is a word from the bot newer than that start. With
  // none yet the run is still running for a grace after the finish (the bot writes its summary around the time
  // it closes its check, in either order), then the check alone says how it went — the whole verdict for a bot
  // that reports through CI and never posts. Without this the summary of the run before would read as this
  // run's result for as long as the new one took to appear.
  for (const check of checks) {
    if (check.startedAt === undefined || check.status !== 'completed') continue;
    const started = Date.parse(check.startedAt);
    const bot = botByCheckName(check.name);
    if (bot === null || Number.isNaN(started)) continue;
    const existing = byId.get(bot.id);
    if (existing === undefined) continue;
    if ((lastWordBy.get(bot.id) ?? Number.NEGATIVE_INFINITY) > started) {
      byId.set(bot.id, { ...existing, runJudged: true });
      continue;
    }
    // The run this check made was the one the bot answered with "Review finished": nothing new, so the run before it
    // stands rather than the check's bare conclusion.
    if (ranForAnswer(bot.id, started)) {
      byId.set(bot.id, { ...afterAnswer(existing), runJudged: true });
      continue;
    }
    const finished = check.completedAt === undefined ? NaN : Date.parse(check.completedAt);
    const awaiting = !Number.isNaN(finished) && now - finished < REPORT_GRACE_MS;
    byId.set(bot.id, {
      id: bot.id,
      login: existing.login,
      verdict: awaiting ? 'running' : (checkVerdict.get(bot.id) ?? 'clean'),
      reviewedSha: existing.reviewedSha,
      checkName: check.name,
      ...(existing.sourceId === undefined ? {} : { sourceId: existing.sourceId }),
      runJudged: true,
    });
  }
  // Judged by the bot's own words, so a summary the Action wrote while the check still ran gives way to it
  // (`withLiveRuns` replaces a saved "running" only with a judged verdict).
  // Requests the bot answered with no review, settled last so no pass before can drop what they leave: the run each set
  // aside, or no word for a bot with none, marked judged so an Action summary saved while the check ran (running) gives
  // way to it in `withLiveRuns`. The check is the answered run when its known start falls in the answer's window, or,
  // with no start (a commit status, which the Action dates by its finish alone), when it finished between the request
  // and the report's grace after the answer; with no time at all, only a green one, whose "clean" is the claim to undo
  // (a failure is never hidden behind an old reply). One still under way with no start may be a new run, and reads running.
  for (const [id, answer] of answeredBy) {
    const record = byId.get(id);
    if (record === undefined || (lastWordBy.get(id) ?? Number.NEGATIVE_INFINITY) > answer.at) continue;
    const started = checkStartedAt.get(id);
    const finished = checkFinishedAt.get(id);
    const ours =
      started !== undefined
        ? ranForAnswer(id, started)
        : record.checkName !== undefined &&
          checkVerdict.get(id) !== 'running' &&
          (finished !== undefined ? finished >= answer.askedAt && finished <= answer.at + REPORT_GRACE_MS : checkVerdict.get(id) === 'clean');
    if (ours) byId.set(id, { ...afterAnswer(record), runJudged: true });
  }
  // An earlier review standing in a refused run took the refused check's commit with the check's record: it is not of
  // that commit (the run there was refused), and which one it is the comments do not say, so it reads as behind.
  for (const [id, refusedSha] of refusedRuns) {
    const record = byId.get(id);
    if (record === undefined || record.verdict === 'running') continue;
    const refusal = record.verdict === 'failed' && record.reason !== undefined;
    byId.set(id, { ...record, runJudged: true, ...(refusal || record.reviewedSha !== refusedSha ? {} : { reviewedSha: UNKNOWN_SHA }) });
  }

  return [...byId.values()];
}

/** A commit no head matches (`mergeWithCrawler` reads it as no head at all): a verdict whose commit is not known. */
export const UNKNOWN_SHA = '0'.repeat(40);

/**
 * How long after a bot's check finishes its report (a summary posted or
 * rewritten, review threads) is still awaited before the check's conclusion
 * is taken as the whole verdict. The bots seen write the summary within
 * seconds of closing the check, in either order.
 */
export const REPORT_GRACE_MS = 90 * 1000;

/** Whether the bot `id` is among a comment's reactors (any of its logins, with or without `[bot]`). */
function reactedBy(comment: BotComment, id: string): boolean {
  const bot = botById(id);
  const logins = new Set((bot?.logins ?? []).flatMap((login) => [login.toLowerCase(), login.toLowerCase().replace(/\[bot\]$/, '')]));
  return (comment.reactedBy ?? []).some((login) => logins.has(login.toLowerCase()) || logins.has(login.toLowerCase().replace(/\[bot\]$/, '')));
}

/**
 * The bots a trigger comment asks for, by id with the login the answer will
 * come from: every registered bot whose trigger phrase the comment contains
 * as a whole, and `@handle` for a user-listed bot.
 */
/**
 * A comment's words with the emphasis marks off, for matching against trigger
 * phrases: backticks, asterisks, tildes, quote marks, and underscores that
 * wrap a word (`_review_`) — not the ones inside one: Qodo's command is
 * `/agentic_review`.
 */
function plainTrigger(text: string): string {
  return text
    .replace(/[`*>~]/g, '')
    .replace(/(^|\s)_+(?=\S)/g, '$1')
    .replace(/(?<=\S)_+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function botsTriggeredBy(body: string, extraLogins: readonly string[] = []): readonly { readonly id: string; readonly login: string }[] {
  const text = ` ${plainTrigger(body)} `;
  const out: { readonly id: string; readonly login: string }[] = [];
  for (const bot of REVIEW_BOTS) {
    if (bot.triggers.some((trigger) => text.includes(` ${trigger.toLowerCase()} `) || text.includes(` ${trigger.toLowerCase()}.`) || text.includes(` ${trigger.toLowerCase()}!`))) {
      out.push({ id: bot.id, login: bot.logins[0] ?? bot.id });
    }
  }
  for (const login of extraLogins) {
    const handle = `@${login.replace(/\[bot\]$/i, '').toLowerCase()}`;
    if (text.includes(` ${handle} `) && !out.some((entry) => entry.login.toLowerCase() === login.toLowerCase())) out.push({ id: `custom:${login.toLowerCase()}`, login });
  }
  return out;
}

/** First configured re-run trigger for a bot id, if any. */
/** The bot's mark as GitHub serves it, for a page that shows none (`null` for a bot without a known App id). */
export function botAppAvatar(bot: ReviewBot, size = 64): string | null {
  return bot.appId === undefined ? null : `https://avatars.githubusercontent.com/in/${bot.appId}?s=${size}&v=4`;
}

export function rerunTriggerFor(botId: string): string | null {
  const bot = botById(botId);
  return bot?.triggers[0] ?? null;
}

/**
 * The bot a trigger comment asks for: a body that is one of a bot's trigger
 * phrases (one per line, markdown noise around it ignored), else null. A
 * person typing "bugbot run" on a pull request is as clear a sign the bot is
 * installed as any comment the bot itself posts.
 */
export function botByTrigger(body: string): ReviewBot | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = plainTrigger(raw);
    if (line === '') continue;
    const bot = REVIEW_BOTS.find((candidate) => candidate.triggers.some((trigger) => trigger.toLowerCase() === line));
    if (bot !== null && bot !== undefined) return bot;
  }
  return null;
}

/** The `/apps/<name>` slug GitHub links a bot's avatar and name to, for each login. */
export function botByAppSlug(slug: string): ReviewBot | null {
  return botByLogin(`${slug.toLowerCase()}[bot]`);
}

const GENERIC_TRIGGER = /^(?:@[\w-]+(?:\[bot\])?|\/[\w-]+)(?:\s+(?:review|run|rerun|re-run|retrigger|full review|summary))?$/i;

/**
 * A comment that only asks a bot to run ("@greptileai", "bugbot run",
 * "/devin review"). Matched whole after trimming markdown noise, against
 * every registered trigger and the generic "@handle verb" shape.
 */
export function isTriggerComment(body: string, extraLogins: readonly string[] = []): boolean {
  // One trigger per line is still only triggers ("/devin review\nbugbot run\n@greptileai").
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length > 1) return lines.length <= 6 && lines.every((line) => isTriggerComment(line, extraLogins));
  if (isSingleTrigger(body, extraLogins)) return true;
  // Several triggers with only whitespace between them ("bugbot run @greptileai /devin review") are still only
  // triggers: the known ones are peeled off the front, longest first, until nothing is left.
  return isTriggerSequence(body, extraLogins);
}

function knownTriggers(extraLogins: readonly string[]): readonly string[] {
  const list = REVIEW_BOTS.flatMap((bot) => bot.triggers.map((trigger) => trigger.toLowerCase()));
  for (const login of extraLogins) list.push(`@${login.replace(/\[bot\]$/i, '').toLowerCase()}`);
  return [...new Set(list)].sort((a, b) => b.length - a.length);
}

function isTriggerSequence(body: string, extraLogins: readonly string[]): boolean {
  let text = plainTrigger(body);
  if (text === '' || text.length > 240) return false;
  const triggers = knownTriggers(extraLogins);
  let count = 0;
  while (text !== '') {
    const match = triggers.find((trigger) => text === trigger || (text.startsWith(trigger) && /^[\s.!,;]/.test(text.slice(trigger.length))));
    if (match === undefined) return false;
    text = text.slice(match.length).replace(/^[\s.!,;]+/, '');
    count += 1;
    if (count > 8) return false;
  }
  return count > 1;
}

function isSingleTrigger(body: string, extraLogins: readonly string[]): boolean {
  const text = plainTrigger(body).replace(/[.!]+$/, '');
  if (text === '' || text.length > 60) return false;
  for (const bot of REVIEW_BOTS) {
    if (bot.triggers.some((trigger) => trigger.toLowerCase() === text)) return true;
  }
  for (const login of extraLogins) {
    const handle = `@${login.replace(/\[bot\]$/i, '').toLowerCase()}`;
    if (text === handle || text.startsWith(`${handle} `)) return GENERIC_TRIGGER.test(text);
  }
  if (!GENERIC_TRIGGER.test(text)) return false;
  // A bare "@someone" is a mention, not a trigger, unless that someone is a known bot handle.
  const handle = /^@([\w-]+)/.exec(text)?.[1];
  if (handle === undefined) return true;
  return REVIEW_BOTS.some((bot) => bot.triggers.some((trigger) => trigger.toLowerCase().startsWith(`@${handle}`)) || bot.logins.some((login) => login.toLowerCase().startsWith(handle)));
}
