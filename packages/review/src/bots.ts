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

export interface ReviewBot {
  readonly id: string;
  readonly title: string;
  readonly logins: readonly string[];
  readonly checkNames: readonly string[];
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
    triggers: ['bugbot run', 'cursor review', '@cursor review'],
    configFiles: ['.cursor/BUGBOT.md'],
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
    id: 'devin',
    title: 'Devin',
    appId: 811515,
    logins: ['devin-ai-integration[bot]', 'devin[bot]'],
    checkNames: ['Devin'],
    triggers: ['/devin review', '@devin review', '@devin'],
    configFiles: [],
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
  // "found no new issues", "no further problems", "0 potential issues": the adjectives between "no" and the noun
  // vary by bot and by run, so a few are allowed through.
  const clean =
    /\bno(?: (?:new|further|additional|other|remaining|potential|actionable|significant|blocking))* (?:issues|bugs|findings|problems)\b/i.test(text) ||
    /\b(?:looks good|lgtm|all clean|no bugs found)\b/i.test(text) ||
    (count === 0 && score === null);
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
  return { count: Number.isFinite(count) ? count : null, score: Number.isFinite(score) ? score : null, clean, severity };
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
  /** The bot's own words for a run it refused (`refusalReason`). */
  readonly reason?: string;
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
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '' || text.length > 400) return null;
  // "Skipping Bugbot: …", "Skipped review: …" — a skip of the run, not of something in the code under review.
  const skipped = /^(?:[\w.-]+(?:\[bot\])?\s*[:,-]\s*)?skipp(?:ing|ed)\s+(?:[A-Z][\w.-]*(?:\[bot\])?\s*[:—–-]|(?:the\s+|this\s+)?(?:review|pull request|pr|run|analysis|scan)\b)/i.test(text);
  const sentences = text.split(/(?<=[.!?])\s+/);
  // Otherwise the sentence must say it about the bot or the review, not about the code: "is disabled" alone
  // describes a feature flag as readily as a bot, and a short review can say exactly that. The one exception is
  // a comment that is nothing but the refusal — "Permission denied.", "Unable to access repository." — a few
  // words with no subject before the phrase; a review of code names what it is about.
  const bare = sentences[0] !== undefined && isBareRefusal(sentences[0]) && (sentences.length === 1 || isBareAdvice(body, text)) ? sentences[0] : undefined;
  const first = skipped ? sentences[0] : (bare ?? sentences.find((sentence) => REFUSAL_PHRASE.test(sentence) && REFUSAL_SUBJECT.test(sentence)));
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
  const rest = lead.slice(match[0].length).replace(/[.!?,;:]+$/, '').trim();
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
  return !/(?:\w[\w-]*[./]\w|\b\w*_\w+\b|\b[a-z]+[A-Z]\w*\b)/.test(raw);
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
  'please', 'try', 'again', 'later', 'contact', 'support', 'enable', 'install', 'upgrade',
  '',
]);

/** What a bot says when it will not run. */
const REFUSAL_PHRASE = new RegExp(
  [
    /\b(?:is|are|was|has been|have been)\s+(?:currently\s+)?(?:disabled|not enabled|not installed|not configured|not set up|not authori[sz]ed|unavailable|turned off|paused)\b/,
    /\b(?:no|out of|insufficient|exceeded|reached)\s+(?:your\s+)?(?:\w+\s+)?(?:credits?|quota|budget|limit|allowance)\b/,
    /\b(?:subscription|plan|trial|billing)\b[^.!?]*\b(?:expired|required|needed|inactive|ended|lapsed|upgrade)\b/,
    /\b(?:could not|couldn.t|cannot|can.t|unable to|failed to)\s+(?:access|read|clone|fetch|start|run|review|analy[sz]e)\b/,
    /\b(?:permission denied|access denied|not authorized|unauthorized|forbidden)\b/,
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
);

/**
 * The sentence is about the bot or its review — a bot's name, "review(s)",
 * "this repository", "your account", credits — rather than about something
 * in the diff. A review bot's own login or title is one of these; so is the
 * second person, since a refusal addresses the reader ("You have no credits").
 */
const REFUSAL_SUBJECT = new RegExp(
  [
    /\b(?:bot|reviews?|reviewer|reviewing|code review|analysis|scan)\b/,
    /\b(?:this|the|your)\s+(?:repo(?:sitory)?|org(?:anization)?|account|project|workspace|team|installation|app|plan|subscription|trial)\b/,
    /\b(?:credits?|quota|billing|seats?)\b/,
    /\byou(?:r)?\b/,
    /\[bot\]/,
    new RegExp(`\\b(?:${REVIEW_BOTS.flatMap((bot) => [bot.title, ...bot.logins.map((login) => login.replace(/\[bot\]$/i, ''))]).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`),
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
);

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
}

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
 * ("resolved"), or as its check ended when it has one. Threads posted before
 * the bot's next summary comment belong to the run that summary reports on.
 */
export function verdictsFrom(
  checks: readonly RawCheckRun[],
  comments: readonly BotComment[],
  headSha: string,
  extraLogins: readonly string[] = [],
  now: number = Date.now(),
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
  const statusOnly = new Map<string, { readonly login: string; readonly anchor: string; readonly at: number | null }>();
  const threadRuns = new Map<string, ThreadRun>();
  /** When each bot last rewrote one of its comments: a summary edited after a run was asked for is that run's report. */
  const lastEditBy = new Map<string, number>();
  for (const comment of comments) {
    const id = reviewBotIdFor(comment.author, extraLogins);
    if (id !== null && comment.editedAt !== undefined) {
      const edited = Date.parse(comment.editedAt);
      if (!Number.isNaN(edited) && edited > (lastEditBy.get(id) ?? Number.NEGATIVE_INFINITY)) lastEditBy.set(id, edited);
    }
    if (id === null) {
      // A person asking a bot to run ("bugbot run", "@greptileai") starts a run as surely as the bot's own
      // "Starting" line does: that bot is running until it speaks (or the line ages, or its check says).
      if (comment.resolved === undefined && isTriggerComment(comment.body, extraLogins)) {
        const at = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
        for (const asked of botsTriggeredBy(comment.body, extraLogins)) {
          // A bot that reacts when it takes a trigger, and has not after the grace: it never saw this one.
          if (!Number.isNaN(at) && now - at > ACK_GRACE_MS && botById(asked.id)?.acknowledges === 'reaction' && !reactedBy(comment, asked.id)) continue;
          threadRuns.delete(asked.id);
          statusOnly.set(asked.id, { login: asked.login, anchor: comment.anchor, at: Number.isNaN(at) ? null : at });
        }
      }
      continue;
    }
    if (comment.resolved !== undefined) {
      // The run the bot announced has reported: its findings are these threads.
      statusOnly.delete(id);
      const run = threadRuns.get(id);
      const open = (run?.open ?? 0) + (comment.resolved ? 0 : 1);
      const openAnchor = run?.openAnchor ?? (comment.resolved ? null : comment.anchor);
      threadRuns.set(id, { login: comment.author, open, openAnchor, lastAnchor: comment.anchor });
      continue;
    }
    if (isTriggerComment(comment.body, extraLogins)) continue;
    const refusal = refusalReason(comment.body);
    if (refusal !== null) {
      // The bot said it would not review: the run that was asked for failed, whatever an earlier run found.
      threadRuns.delete(id);
      statusOnly.delete(id);
      const existing = byId.get(id);
      byId.set(id, { id, login: comment.author, verdict: 'failed', reviewedSha: headSha, ...(existing?.checkName === undefined ? {} : { checkName: existing.checkName }), sourceId: comment.anchor, reason: refusal });
      continue;
    }
    if (isStatusLineComment(comment.body)) {
      // A new run began: the threads so far belong to the run before it.
      threadRuns.delete(id);
      const at = comment.createdAt === undefined ? NaN : Date.parse(comment.createdAt);
      statusOnly.set(id, { login: comment.author, anchor: comment.anchor, at: Number.isNaN(at) ? null : at });
      continue;
    }
    const parsed = parseBotBody(comment.body, id.startsWith('custom:') ? '' : id);
    // A coding agent's reply to a person or to another bot is not its review; only a review-shaped comment votes.
    if (botById(id)?.conversational === true && parsed.count === null && parsed.score === null && !parsed.clean) continue;
    threadRuns.delete(id);
    statusOnly.delete(id);
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
  // A bot whose latest word is "starting" has a run under way or just finished: what it found before belongs to
  // an earlier run (those threads are items in their own right). The check says how this run ended; with no
  // check to go by the bot is running until it says more.
  for (const [id, { login, anchor, at }] of statusOnly) {
    const existing = byId.get(id);
    // The bot rewrote its summary after the run was asked for: that is the report, and the summary's verdict (read
    // above, from its words as they are now) stands. Greptile re-reviews into the same comment.
    const edited = lastEditBy.get(id);
    if (existing !== undefined && at !== null && edited !== undefined && edited > at) continue;
    // Announced long ago, nothing since, no check to say how it went: the run never reported. What the bot said
    // before that stands (from that earlier run); a bot that never said anything else did not review this.
    const stale = at !== null && now - at > STATUS_LINE_STALE_MS;
    if (existing === undefined) {
      byId.set(id, { id, login, verdict: stale ? 'failed' : 'running', reviewedSha: headSha, sourceId: anchor });
      continue;
    }
    if (existing.checkName === undefined) {
      if (!stale) byId.set(id, { id, login, verdict: 'running', reviewedSha: existing.reviewedSha, sourceId: anchor });
      continue;
    }
    const fromCheck = checkVerdict.get(id) ?? 'running';
    byId.set(id, { id, login, verdict: fromCheck, reviewedSha: existing.reviewedSha, checkName: existing.checkName, sourceId: anchor });
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
    const fromCheck = checkName === undefined ? null : checkVerdict.get(id) ?? null;
    if (fromCheck !== null) {
      byId.set(id, { id, login: run.login, verdict: fromCheck, ...(fromCheck === 'clean' ? scored : {}), reviewedSha, ...named, sourceId: run.lastAnchor });
      continue;
    }
    byId.set(id, { id, login: run.login, verdict: 'findings', count: 0, ...scored, reviewedSha, ...named, sourceId: run.lastAnchor });
  }

  return [...byId.values()];
}

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
export function botsTriggeredBy(body: string, extraLogins: readonly string[] = []): readonly { readonly id: string; readonly login: string }[] {
  const text = ` ${body.replace(/[`*_>~]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()} `;
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
