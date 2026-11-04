import type { BotComment, BotVerdictRecord, RawCheckRun } from '@geld/review';
import { botByCheckName, botById, botsTriggeredBy, geldRunAnswer, geldRunBots } from '@geld/review';

/** A bot that answers a trigger with a reaction does so within seconds: past this it most likely never saw the request. */
export const REQUEST_ACK_MS = 20_000;
/** A bot whose first sign is a comment or its check run is given longer, since those land later than a reaction. */
export const REQUEST_ACK_SLOW_MS = 60_000;
/** A trigger comment posted within this long of a click is that click's post (GitHub's clock against the reader's). */
const POST_MATCH_MS = 2 * 60_000;
/** A bot's word or check this long before the request it answers still counts (the two clocks differ by seconds). */
const CLOCK_SLACK_MS = 5_000;

/**
 * Where a request for a review stands before the bot has said anything:
 * `starting` while it still has time to show a sign of life (`until`), then
 * `unanswered` — `silent` when it never did, `not-posted` when the trigger
 * comment never reached GitHub.
 */
export type BotRequestState = { readonly kind: 'starting'; readonly until: number } | { readonly kind: 'unanswered'; readonly reason: 'silent' | 'not-posted' };

/** A request made from Geld this visit: when, and whether its trigger comment posted (null while the post is out). */
export interface BotRequestClick {
  readonly at: number;
  readonly posted: boolean | null;
}

export interface BotRequestInput {
  readonly clicks: ReadonlyMap<string, BotRequestClick>;
  readonly comments: readonly BotComment[];
  readonly checks: readonly RawCheckRun[];
  /** The verdicts as the page and the payload read them, before any request state is laid over them. */
  readonly bots: readonly BotVerdictRecord[];
  readonly extraLogins: readonly string[];
  readonly now: number;
}

function loginKey(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/, '');
}

function loginsOf(id: string, fallback: string): ReadonlySet<string> {
  const logins = botById(id)?.logins ?? [id.startsWith('custom:') ? id.slice('custom:'.length) : fallback];
  return new Set([...logins, fallback].map(loginKey));
}

function timeOf(value: string | undefined): number {
  return value === undefined ? Number.NaN : Date.parse(value);
}

/** Whether the bot showed any sign of taking the request made at `since`: a reaction on it, a word of its own, or its check. */
function acknowledged(id: string, logins: ReadonlySet<string>, trigger: BotComment | null, since: number, input: BotRequestInput): boolean {
  if (trigger !== null && (trigger.reactedBy ?? []).some((login) => logins.has(loginKey(login)))) return true;
  const after = since - CLOCK_SLACK_MS;
  const spoke = input.comments.some((comment) => logins.has(loginKey(comment.author)) && (timeOf(comment.createdAt) >= after || timeOf(comment.editedAt) >= after));
  if (spoke) return true;
  return input.checks.some((check) => {
    if (botByCheckName(check.name)?.id !== id) return false;
    if (check.status === 'queued' || check.status === 'in_progress') return true;
    return timeOf(check.startedAt) >= after || timeOf(check.completedAt) >= after;
  });
}

/**
 * Every bot with a request still waiting on its first sign of life: the ones
 * asked from Geld this visit, and the ones a trigger comment on the page asks
 * for. A request is timed from the click when there was one (the reader's
 * clock), else from its trigger comment. Once its window has passed it reads
 * `unanswered` only while nothing else has settled it: this visit's own ask,
 * or a verdict that is still `running` on the strength of the request alone.
 * Any sign from the bot, however late, clears the state and the verdict reads
 * as the bot's words say.
 */
export function botRequestStates(input: BotRequestInput): ReadonlyMap<string, BotRequestState> {
  const asks = new Map<string, { readonly at: number; readonly comment: BotComment; readonly login: string }>();
  for (const comment of input.comments) {
    const at = timeOf(comment.createdAt);
    if (Number.isNaN(at)) continue;
    for (const { id, login } of botsTriggeredBy(comment.body, input.extraLogins)) {
      // A bot never asks itself: its own reply quoting the command is not a request.
      if (loginsOf(id, login).has(loginKey(comment.author))) continue;
      const previous = asks.get(id);
      if (previous === undefined || at > previous.at) asks.set(id, { at, comment, login });
    }
  }
  const out = new Map<string, BotRequestState>();
  for (const id of new Set([...asks.keys(), ...input.clicks.keys()])) {
    const click = input.clicks.get(id);
    const ask = asks.get(id);
    const posted = ask !== undefined && (click === undefined || ask.at >= click.at - POST_MATCH_MS) ? ask : null;
    if (click === undefined && posted === null) continue;
    if (click !== undefined && click.posted === false && posted === null) {
      out.set(id, { kind: 'unanswered', reason: 'not-posted' });
      continue;
    }
    const record = input.bots.find((bot) => bot.id === id);
    const logins = loginsOf(id, posted?.login ?? record?.login ?? id);
    const since = posted?.at ?? click?.at ?? input.now;
    // A `/geld run` command is answered by the Geld workflow, not the bot: its 🚀 is the run taken, its 👎 no run.
    const viaWorkflow = posted !== null && geldRunBots(posted.comment.body).length > 0;
    const workflow = viaWorkflow && posted !== null ? geldRunAnswer(posted.comment) : null;
    if (workflow === 'failed') {
      out.set(id, { kind: 'unanswered', reason: 'silent' });
      continue;
    }
    if (workflow === 'queued' || acknowledged(id, logins, posted?.comment ?? null, since, input)) continue;
    const start = click?.at ?? since;
    // The workflow's job has to start before it can answer, which takes longer than a bot's reaction.
    const window = !viaWorkflow && botById(id)?.acknowledges === 'reaction' ? REQUEST_ACK_MS : REQUEST_ACK_SLOW_MS;
    if (input.now - start < window) {
      out.set(id, { kind: 'starting', until: start + window });
      continue;
    }
    if (click !== undefined || record?.verdict === 'running') out.set(id, { kind: 'unanswered', reason: 'silent' });
  }
  return out;
}

/**
 * The verdicts with the requests laid over them, so everything downstream
 * agrees with the pill: a request still `starting` is the bot running (a
 * record is made for a bot that never ran here), one `unanswered` is no word
 * when only the request said it was running. The panel draws both states
 * from the same map (`PanelModel.botRequests`).
 */
export function withBotRequests(bots: readonly BotVerdictRecord[], states: ReadonlyMap<string, BotRequestState>, headSha: string): readonly BotVerdictRecord[] {
  if (states.size === 0) return bots;
  const out = bots.map((bot) => {
    const state = states.get(bot.id);
    if (state === undefined) return bot;
    if (state.kind === 'starting') return bot.verdict === 'running' ? bot : { ...bot, verdict: 'running' as const };
    return bot.verdict === 'running' ? { ...bot, verdict: 'unknown' as const } : bot;
  });
  for (const [id, state] of states) {
    if (bots.some((bot) => bot.id === id)) continue;
    const login = botById(id)?.logins[0] ?? (id.startsWith('custom:') ? id.slice('custom:'.length) : id);
    out.push({ id, login, verdict: state.kind === 'starting' ? 'running' : 'unknown', reviewedSha: headSha });
  }
  return out;
}

/** The earliest moment a `starting` request becomes `unanswered`, for the pass that has to draw it. */
export function nextRequestDeadline(states: ReadonlyMap<string, BotRequestState>): number | null {
  let next: number | null = null;
  for (const state of states.values()) {
    if (state.kind === 'starting' && (next === null || state.until < next)) next = state.until;
  }
  return next;
}

/** The pill's short word for a request still waiting on the bot. */
export function requestDetail(state: BotRequestState): string {
  return state.kind === 'starting' ? 'starting' : state.reason === 'not-posted' ? 'not posted' : 'no response';
}

/** The sentence for a request's state, on the pill's label and the bot's card. */
export function requestSentence(state: BotRequestState): string {
  if (state.kind === 'starting') return 'Asked to review just now, waiting for it to start';
  if (state.reason === 'not-posted') return 'Geld couldn\u2019t post the request to GitHub. Try again';
  return 'Didn\u2019t respond to the request, so it likely didn\u2019t run. If it answers later, it shows here';
}
