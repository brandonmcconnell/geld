/**
 * Known review bots: logins, check-run names, re-run triggers, and the
 * config files that mean "this bot is installed". Extra logins from the
 * user's `reviewBots` setting are treated as unnamed bots.
 */

export interface ReviewBot {
  readonly id: string;
  readonly title: string;
  readonly logins: readonly string[];
  readonly checkNames: readonly string[];
  readonly triggers: readonly string[];
  readonly configFiles: readonly string[];
  /**
   * A coding agent that also reviews: most of its comments are replies and
   * progress notes (to a person, or to another bot's review), so only a
   * comment shaped like a review (a score, a findings count, "no issues")
   * counts as its verdict.
   */
  readonly conversational?: boolean;
}

export const REVIEW_BOTS: readonly ReviewBot[] = [
  {
    id: 'bugbot',
    title: 'Bugbot',
    logins: ['cursor[bot]', 'cursor-bugs[bot]', 'bugbot[bot]', 'cursor-com[bot]'],
    checkNames: ['Cursor Bugbot', 'Bugbot'],
    triggers: ['bugbot run', 'cursor review', '@cursor review'],
    configFiles: ['.cursor/BUGBOT.md'],
  },
  {
    id: 'greptile',
    title: 'Greptile',
    logins: ['greptile-apps[bot]', 'greptile[bot]'],
    checkNames: ['Greptile'],
    triggers: ['@greptileai', '@greptile', '@greptileai review'],
    configFiles: ['.greptile.yml', '.greptile.yaml'],
  },
  {
    id: 'devin',
    title: 'Devin',
    logins: ['devin-ai-integration[bot]', 'devin[bot]'],
    checkNames: ['Devin'],
    triggers: ['/devin review', '@devin review', '@devin'],
    configFiles: [],
  },
  {
    id: 'codex',
    title: 'Codex',
    logins: ['chatgpt-codex-connector[bot]', 'openai-codex[bot]', 'codex[bot]'],
    checkNames: ['Codex'],
    triggers: ['@codex review', '@codex'],
    configFiles: ['.codex/', 'AGENTS.md'],
  },
  {
    id: 'copilot',
    title: 'Copilot',
    logins: ['copilot-pull-request-reviewer[bot]', 'copilot[bot]'],
    checkNames: ['Copilot code review', 'Copilot'],
    triggers: ['@copilot'],
    configFiles: ['.github/copilot-instructions.md'],
  },
  {
    id: 'coderabbit',
    title: 'CodeRabbit',
    logins: ['coderabbitai[bot]'],
    checkNames: ['CodeRabbit'],
    triggers: ['@coderabbitai review', '@coderabbitai full review', '@coderabbitai'],
    configFiles: ['.coderabbit.yaml', '.coderabbit.yml'],
  },
  {
    id: 'gemini',
    title: 'Gemini Code Assist',
    logins: ['gemini-code-assist[bot]'],
    checkNames: ['Gemini Code Assist', 'gemini-code-assist'],
    triggers: ['@gemini-code-assist'],
    configFiles: [],
  },
  {
    // Replicas (replicas.dev): cloud coding agents with a "Code Review" automation that posts an X/5 review score
    // on PR open and sync; `/replicas run code-review` runs it on demand, `@tryreplicas` addresses the agent.
    id: 'replicas',
    title: 'Replicas',
    logins: ['replicas-connector[bot]', 'replicas-dev[bot]', 'tryreplicas[bot]'],
    checkNames: ['Replicas'],
    triggers: ['/replicas run code-review', '@tryreplicas review', '@tryreplicas', '@replicas'],
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
  return REVIEW_BOTS.find((bot) => bot.checkNames.some((check) => lower.includes(check.toLowerCase()))) ?? null;
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
}

/**
 * Pull a findings count or score out of a bot's summary comment. Conservative:
 * unknown shapes return nulls rather than inventing numbers.
 */
export function parseBotBody(body: string, botId: string): ParsedBotBody {
  const text = body.replace(/\r\n/g, '\n');
  const scoreMatch = /(\d+(?:\.\d+)?)\s*\/\s*5\b/.exec(text);
  const score = scoreMatch?.[1] !== undefined ? Number.parseFloat(scoreMatch[1]) : null;
  const countMatch =
    botId === 'greptile'
      ? /(?:found|reported)\s+(\d+)\s+(?:issue|finding|comment)/i.exec(text)
      : /(\d+)\s+(?:issue|finding|bug|problem)s?\b/i.exec(text);
  const count = countMatch?.[1] !== undefined ? Number.parseInt(countMatch[1], 10) : null;
  const clean =
    /\bno (?:issues|bugs|findings|problems)\b/i.test(text) ||
    /\b(?:looks good|lgtm|all clean|no bugs found)\b/i.test(text) ||
    (count === 0 && score === null);
  const severity: FindingSeverity | null = /\b(?:high severity|critical|blocker|security (?:issue|vulnerability|risk))\b/i.test(text)
    ? 'high'
    : /\bmedium(?: severity)?\b/i.test(text)
      ? 'medium'
      : /\blow(?: severity)?\b/i.test(text)
        ? 'low'
        : null;
  return { count: Number.isFinite(count) ? count : null, score: Number.isFinite(score) ? score : null, clean, severity };
}

export interface RawCheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly sha: string;
}

export interface DerivedBotVerdict {
  readonly id: string;
  readonly login: string;
  readonly verdict: 'clean' | 'findings' | 'failed' | 'running';
  readonly count?: number;
  readonly score?: number;
  readonly severity?: FindingSeverity;
  readonly reviewedSha: string;
  readonly checkName?: string;
  readonly sourceId?: string;
}

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
export function isStatusLineComment(body: string): boolean {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '' || text.length > 240) return false;
  const sentences = text.split(/(?<=[.!…])\s+/).filter((part) => part !== '');
  if (sentences.length > 2) return false;
  // The verb of a run under way, with what it is running on named in the same sentence ("Starting Devin Review.",
  // "Bugbot is reviewing your changes"), never a sentence that merely begins with such a word ("Starting from line 12, …").
  const underWay = /^(?:[\w.-]+(?:\[bot\])?\s+)?(?:is\s+)?(?:now\s+)?(?:starting|started|beginning|kicking off|running|reviewing|analy[sz]ing|looking (?:at|into|over)|working on|scanning|checking)\b[^.!…]*\b(?:review|analysis|scan|changes|pull request|pr|code|diff|your|this)\b/i;
  const stated = /^(?:review|analysis|scan)\s+(?:in progress|started|queued|has started)\b/i;
  const promise = /\b(?:will|I'?ll)\s+(?:post|comment|report|reply|start|begin|review)\b.*\b(?:when|once|shortly|soon)\b/i;
  return underWay.test(text) || stated.test(text) || promise.test(text);
}

/**
 * Combine check-run conclusions with the bot's own comments. A green check
 * with "no issues" is `clean`; a completed check plus findings in comments is
 * `findings`; an in-progress check is `running`. A comment that only says
 * the run started does not vote: a bot whose check finished green and that
 * flagged nothing since is `clean` (Devin says it is looking and then says
 * nothing more when all is well); with no check to go by, such a bot is
 * `running` until it says more.
 */
export function verdictsFrom(
  checks: readonly RawCheckRun[],
  comments: readonly { readonly author: string; readonly body: string; readonly anchor: string }[],
  headSha: string,
  extraLogins: readonly string[] = [],
): readonly DerivedBotVerdict[] {
  const byId = new Map<string, DerivedBotVerdict>();
  /** What each bot's check alone said, for a run its comments have not spoken about. */
  const checkVerdict = new Map<string, 'clean' | 'failed' | 'running'>();

  for (const check of checks) {
    const bot = botByCheckName(check.name);
    if (bot === null) continue;
    const login = bot.logins[0] ?? bot.id;
    const running = check.status !== 'completed';
    const failed = check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled';
    const verdict = running ? 'running' : failed ? 'failed' : 'clean';
    checkVerdict.set(bot.id, verdict);
    const record: DerivedBotVerdict = {
      id: bot.id,
      login,
      verdict,
      reviewedSha: check.sha || headSha,
      checkName: check.name,
    };
    byId.set(bot.id, record);
  }

  /** Bots whose latest comment so far is a status line (the run it announced has not reported), with that line. */
  const statusOnly = new Map<string, { readonly login: string; readonly anchor: string }>();
  for (const comment of comments) {
    const id = reviewBotIdFor(comment.author, extraLogins);
    if (id === null || isTriggerComment(comment.body, extraLogins)) continue;
    if (isStatusLineComment(comment.body)) {
      statusOnly.set(id, { login: comment.author, anchor: comment.anchor });
      continue;
    }
    const parsed = parseBotBody(comment.body, id.startsWith('custom:') ? '' : id);
    // A coding agent's reply to a person or to another bot is not its review; only a review-shaped comment votes.
    if (botById(id)?.conversational === true && parsed.count === null && parsed.score === null && !parsed.clean) continue;
    statusOnly.delete(id);
    const existing = byId.get(id);
    const login = comment.author;
    if (existing !== undefined) {
      const verdict = parsed.clean && existing.verdict === 'failed' ? 'findings' : parsed.clean ? 'clean' : parsed.count === 0 ? 'clean' : 'findings';
      byId.set(id, withOptionalCount({ ...existing, verdict, sourceId: comment.anchor, login }, parsed));
      continue;
    }
    const verdict = parsed.clean ? 'clean' : 'findings';
    byId.set(id, withOptionalCount({ id, login, verdict, reviewedSha: headSha, sourceId: comment.anchor }, parsed));
  }
  // A bot whose latest word is "starting" has a run under way or just finished: what it found before belongs to
  // an earlier run (those threads are items in their own right). The check says how this run ended; with no
  // check to go by the bot is running until it says more.
  for (const [id, { login, anchor }] of statusOnly) {
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, { id, login, verdict: 'running', reviewedSha: headSha, sourceId: anchor });
      continue;
    }
    if (existing.checkName === undefined) {
      byId.set(id, { id, login, verdict: 'running', reviewedSha: existing.reviewedSha, sourceId: anchor });
      continue;
    }
    const fromCheck = checkVerdict.get(id) ?? 'running';
    byId.set(id, { id, login, verdict: fromCheck, reviewedSha: existing.reviewedSha, checkName: existing.checkName, sourceId: anchor });
  }

  return [...byId.values()];
}

/** First configured re-run trigger for a bot id, if any. */
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
    const line = raw.replace(/[`*_>~]/g, '').trim().toLowerCase();
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
  let text = body.replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  const text = body
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '')
    .toLowerCase();
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
