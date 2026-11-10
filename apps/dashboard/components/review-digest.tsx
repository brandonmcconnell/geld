'use client';
import { useState } from 'react';
import { Markdown } from './markdown';
import { REVIEW_BOTS } from '@geld/review/bots';
import { trustedDigests } from '@/lib/trusted-digest';
import type { BotVerdictRecord } from '@geld/review/model';
import type { ReviewData } from '@/lib/review-contracts';
import { Check, MessageSquare, GitPullRequest, ArrowUpRight, Flag, RefreshCw, X } from './icons';
function safeLink(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '#';
  } catch {
    return '#';
  }
}
export function ReviewDigest({ data }: { readonly data: ReviewData }) {
  const [discussionOnly, setDiscussionOnly] = useState(false);
  const summaries = trustedDigests(data.pull.ref.provider, data.comments);
  const meta = summaries
    .map((summary) => summary.meta)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  const summaryIds = new Set(summaries.map((summary) => summary.id));
  const essential = data.files.filter((file) => !file.hidden);
  const hidden = data.files.filter((file) => file.hidden);
  const comments = data.comments
    .filter((comment) => !summaryIds.has(comment.id))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return (
    <>
      <div className="digest-view-switch" role="group" aria-label="Conversation view">
        <button type="button" aria-pressed={!discussionOnly} onClick={() => setDiscussionOnly(false)}>
          Digest
        </button>
        <button type="button" aria-pressed={discussionOnly} onClick={() => setDiscussionOnly(true)}>
          Discussion
        </button>
      </div>
      <section className="digest-overview">
        <div className="digest-description">
          <h2>{discussionOnly ? 'Description' : 'Summary'}</h2>
          <Markdown>
            {(!discussionOnly && meta?.headSha === data.pull.headSha ? meta.summary?.tldr : null) ??
              (data.pull.body || 'No description provided.')}
          </Markdown>
        </div>
        <dl className="digest-facts">
          <div>
            <dt>Essential</dt>
            <dd>
              {essential.length} {essential.length === 1 ? 'file' : 'files'}
            </dd>
          </div>
          <div>
            <dt>Hidden</dt>
            <dd>
              {hidden.length} {hidden.length === 1 ? 'file' : 'files'}
            </dd>
          </div>
          <div>
            <dt>Review requests</dt>
            <dd>{data.pull.reviewers.length ? data.pull.reviewers.join(', ') : 'None'}</dd>
          </div>
        </dl>
      </section>
      {!discussionOnly && meta && (
        <section className="digest-status">
          <div className="review-section-heading">
            <h2>Review status</h2>
            <span>
              {meta.headSha !== data.pull.headSha
                ? 'From an earlier commit'
                : `At ${meta.headSha.slice(0, 7)}`}
            </span>
          </div>
          <div className="digest-findings">
            {meta.items.map((item) => (
              <article key={item.id} data-status={item.status}>
                <span className="finding-severity">{item.severity}</span>
                <div>
                  <Markdown>{item.title}</Markdown>
                  {item.path && (
                    <code>
                      {item.path}
                      {item.line ? `:${item.line}` : ''}
                    </code>
                  )}
                  {item.context && (
                    <details>
                      <summary>Context</summary>
                      <Markdown>{item.context}</Markdown>
                    </details>
                  )}
                  {item.fix && (
                    <details>
                      <summary>Suggested change</summary>
                      <Markdown>{item.fix.text}</Markdown>
                    </details>
                  )}
                </div>
                <span>{item.status.replaceAll('_', ' ')}</span>
              </article>
            ))}
          </div>
          <div className="digest-status-list">
            {meta.bots.map((bot) => (
              <BotStatus key={bot.id} bot={bot} head={data.pull.headSha} />
            ))}
            {meta.reviewers.map((reviewer) => (
              <div key={reviewer.login}>
                <GitPullRequest size={15} />
                <span>{reviewer.login}</span>
                <span className="digest-verdict">{reviewer.state.replaceAll('_', ' ')}</span>
              </div>
            ))}
          </div>
          {!!meta.previews?.length && (
            <div className="digest-previews">
              {meta.previews.map((preview) => (
                <a
                  key={`${preview.host}:${preview.project}:${preview.anchor}`}
                  href={safeLink(preview.url ?? preview.inspectUrl ?? data.pull.url)}
                >
                  {preview.project}
                  <span>{preview.status}</span>
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="digest-discussion">
        <div className="review-section-heading">
          <h2>Discussion</h2>
          <a href={safeLink(data.pull.url)}>
            Full timeline <ArrowUpRight size={13} />
          </a>
        </div>
        {data.commentsUnavailable && (
          <p className="inline-note">
            Some discussion could not be loaded. Open the provider for the complete timeline.
          </p>
        )}
        {!comments.length ? (
          <p className="muted">No comments yet.</p>
        ) : (
          <ol className="discussion-timeline" role="list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <span className="timeline-icon">
                  <MessageSquare size={14} />
                </span>
                <article>
                  <header>
                    <strong>{comment.author}</strong>
                    <span>commented</span>
                    {comment.createdAt && (
                      <time dateTime={comment.createdAt}>
                        {new Date(comment.createdAt).toLocaleDateString('en', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </time>
                    )}
                    <a href={safeLink(comment.url)} aria-label={`Open ${comment.author}’s comment`}>
                      <ArrowUpRight size={13} />
                    </a>
                  </header>
                  <Markdown>{comment.body}</Markdown>
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function BotStatus({ bot, head }: { readonly bot: BotVerdictRecord; readonly head: string }) {
  const reviewed = bot.reviewedSha.toLowerCase();
  const current = head.toLowerCase();
  const matches =
    current.length >= 7 &&
    (reviewed === current || reviewed.startsWith(current) || current.startsWith(reviewed));
  const pending = ['running', 'loading', 'unknown'].includes(bot.verdict);
  const earlier = !pending && !matches;
  const label = earlier
    ? 'Earlier commit'
    : bot.verdict === 'failed' && bot.reason
      ? 'Skipped'
      : bot.verdict === 'unknown'
        ? 'No report'
        : bot.verdict;
  const Icon = earlier
    ? GitPullRequest
    : pending
      ? RefreshCw
      : bot.verdict === 'clean'
        ? Check
        : bot.verdict === 'findings'
          ? Flag
          : X;
  return (
    <div data-stale={earlier}>
      <Icon size={15} />
      <span>
        {REVIEW_BOTS.find((source) => source.id === bot.id || source.logins.includes(bot.login))?.title ??
          bot.login.replace(/\[bot\]$/, '')}
      </span>
      <span
        className="digest-verdict"
        title={bot.reason ?? (earlier ? 'Reviewed ' + bot.reviewedSha.slice(0, 7) : undefined)}
      >
        {label}
        {!earlier && !pending && bot.count !== undefined ? ' · ' + bot.count : ''}
        {!earlier && !pending && bot.score !== undefined ? ' · ' + bot.score + '/5' : ''}
      </span>
    </div>
  );
}
