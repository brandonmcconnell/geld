import type { BotVerdictRecord } from './model';

export type BotHealth = 'good' | 'warn' | 'severe' | 'bad' | 'pending';

export function allResolved(bot: BotVerdictRecord): boolean {
  return bot.verdict === 'findings' && bot.count === 0;
}

export function botHealth(bot: BotVerdictRecord): BotHealth {
  // No word either way (asked on a pull request since merged or closed, no comment, the checks gone): grey, like a run
  // not yet settled — not red, nothing says it failed.
  if (bot.verdict === 'running' || bot.verdict === 'loading' || bot.verdict === 'unknown') return 'pending';
  // A run the bot refused ("disabled for this repository") is a warning, not a failure: nothing is wrong with the
  // pull request, the bot's setup is. A run that broke with no word is a failure.
  if (bot.verdict === 'failed') return bot.reason === undefined ? 'bad' : 'warn';
  if (bot.verdict === 'clean' || allResolved(bot)) return 'good';
  // Findings are amber until they are resolved, and the exclamation while one the bot marks severe (a high grade, or a
  // score under 3/5) is still open: the red cross is only for a run that broke. The request menu still ticks a bot
  // whose findings came before the latest push, so a rerun is a click away.
  if (isSevere(bot)) return 'severe';
  // A 5/5 with a finding still open is amber too, as `botDetail`'s "5/5 · 1 issue" says.
  const open = bot.verdict === 'findings' && bot.count !== undefined && bot.count > 0;
  if (bot.score !== undefined && bot.score >= 5 && !open) return 'good';
  return 'warn';
}

export function isSevere(bot: BotVerdictRecord): boolean {
  if (bot.verdict !== 'findings' || allResolved(bot)) return false;
  return bot.severity === 'high' || (bot.score !== undefined && bot.score < 3);
}
