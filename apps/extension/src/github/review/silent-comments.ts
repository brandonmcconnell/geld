export interface SilentCandidate {
  readonly anchor: string;
  readonly bot: boolean;
  /** A request for a review bot ("@greptileai", "/geld run bugbot"). */
  readonly trigger: boolean;
  /** A bot's line that only says a run started or ended. */
  readonly statusLine: boolean;
}

/**
 * The comments that fold without a row: a person's requests and bots' run-status lines. A status line a bot's chip
 * opens keeps its row, as the bot's own word; a request the chip opens while the bot runs is seated at the bot's
 * line instead (`requestSeat`).
 */
export function silentCommentAnchors(comments: readonly SilentCandidate[], opened: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(comments.filter((entry) => (!entry.bot && entry.trigger) || (entry.statusLine && !opened.has(entry.anchor))).map((entry) => entry.anchor));
}

/** The bot whose line a chip opening `anchor` leads to, with that line's summary anchor, when `anchor` has no row of its own. */
export function requestSeat(anchor: string, bots: ReadonlyArray<{ readonly id: string; readonly sourceId?: string }>, lineAnchorByBot: ReadonlyMap<string, string | null>): { readonly bot: string; readonly sub: string | null } | null {
  const bot = bots.find((entry) => entry.sourceId === anchor);
  return bot === undefined ? null : { bot: bot.id, sub: lineAnchorByBot.get(bot.id) ?? null };
}
