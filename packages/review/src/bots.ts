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

export interface ParsedBotBody {
  readonly count: number | null;
  readonly score: number | null;
  readonly clean: boolean;
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
  return { count: Number.isFinite(count) ? count : null, score: Number.isFinite(score) ? score : null, clean };
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
  readonly reviewedSha: string;
  readonly checkName?: string;
  readonly sourceId?: string;
}

function withOptionalCount(base: DerivedBotVerdict, count: number | null, score: number | null): DerivedBotVerdict {
  return {
    ...base,
    ...(count !== null ? { count } : {}),
    ...(score !== null ? { score } : {}),
  };
}

/**
 * Combine check-run conclusions with the bot's own comments. A green check
 * with "no issues" is `clean`; a completed check plus findings in comments is
 * `findings`; an in-progress check is `running`.
 */
export function verdictsFrom(
  checks: readonly RawCheckRun[],
  comments: readonly { readonly author: string; readonly body: string; readonly anchor: string }[],
  headSha: string,
  extraLogins: readonly string[] = [],
): readonly DerivedBotVerdict[] {
  const byId = new Map<string, DerivedBotVerdict>();

  for (const check of checks) {
    const bot = botByCheckName(check.name);
    if (bot === null) continue;
    const login = bot.logins[0] ?? bot.id;
    const running = check.status !== 'completed';
    const failed = check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled';
    const verdict = running ? 'running' : failed ? 'failed' : 'clean';
    const record: DerivedBotVerdict = {
      id: bot.id,
      login,
      verdict,
      reviewedSha: check.sha || headSha,
      checkName: check.name,
    };
    byId.set(bot.id, record);
  }

  for (const comment of comments) {
    const id = resolveBotId(comment.author, extraLogins);
    if (id === null) continue;
    const parsed = parseBotBody(comment.body, id.startsWith('custom:') ? '' : id);
    const existing = byId.get(id);
    const login = comment.author;
    if (existing !== undefined) {
      const verdict = parsed.clean && existing.verdict === 'failed' ? 'findings' : parsed.clean ? 'clean' : parsed.count === 0 ? 'clean' : 'findings';
      byId.set(id, withOptionalCount({ ...existing, verdict, sourceId: comment.anchor, login }, parsed.count, parsed.score));
      continue;
    }
    const verdict = parsed.clean ? 'clean' : 'findings';
    byId.set(
      id,
      withOptionalCount(
        { id, login, verdict, reviewedSha: headSha, sourceId: comment.anchor },
        parsed.count,
        parsed.score,
      ),
    );
  }

  return [...byId.values()];
}

/** First configured re-run trigger for a bot id, if any. */
export function rerunTriggerFor(botId: string): string | null {
  const bot = botById(botId);
  return bot?.triggers[0] ?? null;
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
