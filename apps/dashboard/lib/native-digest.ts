import { botByLogin, verdictsFrom, UNKNOWN_SHA, looksLikeBotLogin } from '@geld/review/bots';
import type { BotComment } from '@geld/review/bots';
import type { ProviderActivity } from '@geld/domain';
import type { ReviewData } from './review-contracts';
import type { ReviewFeed } from './review-feed';
import { trustedDigests } from './trusted-digest';

export function nativeDigest(data: ReviewData, feed: ReviewFeed, loading = false) {
  const summaries = trustedDigests(data.pull.ref.provider, data.comments);
  const summaryIds = new Set(
    summaries.map(
      (item) => `comment:${data.comments.find((comment) => comment.id === item.id)?.databaseId ?? item.id}`,
    ),
  );
  const meta = summaries
    .map((item) => item.meta)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  const comments: ProviderActivity[] = data.comments.map((comment) => ({
    id: `comment:${comment.databaseId ?? comment.id}`,
    kind: 'comment',
    actor: comment.author,
    avatar: null,
    at: comment.createdAt ?? '',
    title: 'commented',
    body: comment.body,
    state: null,
    sha: null,
  }));
  const timeline = [
    ...new Map([...comments, ...feed.activity].map((event) => [event.id, event])).values(),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const checks = [
    ...new Map(
      [...feed.checks]
        .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
        .map((check) => [`${check.name}:${check.id.includes(':status:') ? 'status' : 'check'}`, check]),
    ).values(),
  ].filter((check) => check.sha === data.pull.headSha);
  const botComments: BotComment[] = timeline
    .filter((event) => event.body && !summaryIds.has(event.id))
    .map((event) => ({
      author: event.actor,
      body: event.body,
      anchor: event.id,
      ...(event.at ? { createdAt: event.at } : {}),
    }));
  for (const thread of data.threads)
    for (const comment of thread.comments)
      botComments.push({
        author: comment.author,
        body: comment.body,
        anchor: `thread:${thread.id}:${comment.id}`,
        resolved: thread.resolved,
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
      });
  const derived = verdictsFrom(
    checks.map((check) => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      sha: check.sha,
      ...(check.startedAt ? { startedAt: check.startedAt } : {}),
      ...(check.completedAt ? { completedAt: check.completedAt } : {}),
    })),
    botComments,
    data.pull.headSha,
    [],
    Date.now(),
    {
      partial:
        loading ||
        !!feed.checksCursor ||
        feed.activityUnavailable ||
        !!feed.activityCursor ||
        data.commentsUnavailable ||
        feed.checksUnavailable,
      complete:
        !loading &&
        !feed.checksUnavailable &&
        !feed.checksCursor &&
        !data.commentsUnavailable &&
        !data.threadsUnavailable &&
        !feed.activityUnavailable &&
        !feed.activityCursor,
      closed: data.pull.state !== 'open',
    },
  );
  const bots = new Map(
    (meta?.bots ?? []).map((bot) => [
      bot.id,
      {
        id: bot.id,
        login: bot.login,
        verdict: bot.verdict,
        reviewedSha: bot.reviewedSha,
        score: bot.score ?? null,
        count: bot.count ?? null,
        reason: bot.reason ?? '',
      },
    ]),
  );
  for (const bot of derived) {
    const event = timeline.find((item) => item.id === bot.sourceId);
    const prior = bots.get(bot.id);
    const hasCheck = checks.some((check) => check.name === bot.checkName);
    // A comment alone does not identify the reviewed commit. Keep that uncertainty visible.
    const reviewedSha = event?.sha ?? (hasCheck ? bot.reviewedSha : (prior?.reviewedSha ?? UNKNOWN_SHA));
    bots.set(bot.id, {
      id: bot.id,
      login: bot.login,
      verdict: bot.verdict,
      reviewedSha,
      score: bot.score ?? null,
      count: bot.count ?? null,
      reason: bot.reason ?? '',
    });
  }
  const reviewers = new Map<
    string,
    { login: string; state: string; avatar: string | null; sha: string | null }
  >();
  const judgments = new Map<string, string>();
  for (const event of timeline) {
    if (event.state === 'dismissed' && event.targetId) {
      const subject = timeline.find((item) => item.id === event.targetId);
      if (subject && judgments.get(subject.actor) === subject.id)
        reviewers.set(subject.actor, {
          login: subject.actor,
          state: 'dismissed',
          avatar: subject.avatar,
          sha: subject.sha,
        });
    }
    if (event.kind !== 'review' || botByLogin(event.actor)) continue;
    if (
      event.state === 'commented' &&
      ['approved', 'changes_requested'].includes(reviewers.get(event.actor)?.state ?? '')
    )
      continue;
    if (['approved', 'changes_requested'].includes(event.state ?? '')) judgments.set(event.actor, event.id);
    reviewers.set(event.actor, {
      login: event.actor,
      state: event.state ?? 'commented',
      avatar: event.avatar,
      sha: event.sha,
    });
  }
  for (const login of data.pull.reviewers)
    if (!botByLogin(login)) {
      const previous = reviewers.get(login);
      if (data.pull.ref.provider === 'github' || !previous || previous.state === 'dismissed')
        reviewers.set(login, { login, state: 'requested', avatar: previous?.avatar ?? null, sha: null });
    }
  const openThreads = data.threads.filter((thread) => !thread.resolved);
  const failedChecks = checks.filter((check) =>
    ['failure', 'timed_out', 'action_required'].includes(check.conclusion ?? ''),
  );
  return {
    meta,
    timeline,
    discussion: timeline.filter(
      (event) => event.kind === 'comment' && !summaryIds.has(event.id) && !looksLikeBotLogin(event.actor),
    ),
    checks,
    bots: [...bots.values()],
    reviewers: [...reviewers.values()],
    openThreads,
    failedChecks,
  };
}
