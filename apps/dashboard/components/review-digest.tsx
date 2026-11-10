'use client';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { botById, botByLogin } from '@geld/review/bots';
import type { ProviderActivity } from '@geld/domain';
import { useReviewFeed } from '@/lib/use-review-feed';
import { nativeDigest } from '@/lib/native-digest';
import type { ReviewData } from '@/lib/review-contracts';
import { Button } from './button';
import { Markdown } from './markdown';
import { ReviewThreads } from './review-threads';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import {
  Check,
  CheckCheck,
  ChevronDown,
  CodeXml,
  FileCode2,
  Flag,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from './icons';
import type { AppIcon } from './icons';

function Group({
  title,
  icon: Icon,
  count,
  children,
  open = true,
  id,
}: {
  readonly title: string;
  readonly icon: AppIcon;
  readonly count?: string | number;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly id?: string;
}) {
  return (
    <Collapsible className="digest-group" defaultOpen={open} id={id}>
      <h2>
        <CollapsibleTrigger className="digest-group-trigger">
          <Icon size={16} />
          <span>{title}</span>
          {count !== undefined && <small>{count}</small>}
          <ChevronDown size={14} />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="digest-group-panel">{children}</CollapsibleContent>
    </Collapsible>
  );
}
function Avatar({ name, src }: { readonly name: string; readonly src?: string | null }) {
  return (
    <span className="digest-avatar" aria-hidden="true">
      {src?.startsWith('https://') ? (
        <Image src={src} alt="" width={24} height={24} unoptimized />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
function statusLabel(state: string) {
  const labels: Record<string, string> = {
    requested: 'Review requested',
    approved: 'Approved',
    changes_requested: 'Changes requested',
    commented: 'Commented',
    dismissed: 'Dismissed',
    clean: 'No open findings',
    findings: 'Findings',
    running: 'Running',
    unknown: 'No verdict',
    loading: 'Loading',
    failed: 'Run failed',
    cancelled: 'Cancelled',
    in_progress: 'Running',
    success: 'Passed',
    failure: 'Failed',
    skipped: 'Skipped',
    neutral: 'Neutral',
    action_required: 'Action required',
    timed_out: 'Timed out',
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}
function Status({ state }: { readonly state: string }) {
  const success = ['success', 'approved', 'clean', 'resolved'].includes(state);
  const bad = ['failure', 'failed', 'timed_out', 'changes_requested', 'findings', 'action_required'].includes(
    state,
  );
  const Icon = success
    ? Check
    : bad
      ? Flag
      : ['in_progress', 'running', 'loading'].includes(state)
        ? RefreshCw
        : MessageSquare;
  return (
    <span className="digest-status-label" data-tone={success ? 'success' : bad ? 'attention' : 'neutral'}>
      <Icon size={13} />
      {statusLabel(state)}
    </span>
  );
}
function Event({ event }: { readonly event: ProviderActivity }) {
  const Icon =
    event.kind === 'commit'
      ? CodeXml
      : event.kind === 'review'
        ? CheckCheck
        : event.kind === 'event'
          ? GitPullRequest
          : MessageSquare;
  return (
    <li className={`activity-event activity-${event.kind}`} id={`activity-${encodeURIComponent(event.id)}`}>
      <span className="activity-marker">
        <Icon size={14} />
      </span>
      <article>
        <header>
          <Avatar name={event.actor} src={event.avatar} />
          <strong>{event.actor}</strong>
          <span>{event.title}</span>
          {event.state && <Status state={event.state} />}
          {event.at && Number.isFinite(Date.parse(event.at)) && (
            <time dateTime={event.at} title={event.at}>
              {new Date(event.at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </time>
          )}
        </header>
        {event.sha && <code className="activity-commit">{event.sha.slice(0, 7)}</code>}
        {event.body && (
          <div className="activity-body">
            <Markdown>{event.body}</Markdown>
          </div>
        )}
      </article>
    </li>
  );
}
export function ReviewDigest({
  data,
  onOpenDiff,
  onChange,
  children,
  revision,
}: {
  readonly data: ReviewData;
  readonly onOpenDiff: () => void;
  readonly onChange: () => void;
  readonly children?: ReactNode;
  readonly revision: number;
}) {
  const [view, setView] = useState<'digest' | 'timeline'>('digest');
  const live = useReviewFeed(data.pull, revision);
  const digest = useMemo(() => nativeDigest(data, live.feed, live.busy), [data, live.feed, live.busy]);
  const essential = data.files.filter((file) => !file.hidden);
  const hidden = data.files.filter((file) => file.hidden);
  const categories = [
    ...new Map(
      hidden.map((file) => [
        file.category ?? 'Other',
        hidden.filter((item) => item.category === file.category).length,
      ]),
    ).entries(),
  ];
  const totalLines = data.files.reduce((n, file) => n + file.additions + file.deletions, 0);
  const essentialLines = essential.reduce((n, file) => n + file.additions + file.deletions, 0);
  const passed = digest.checks.filter((check) => check.conclusion === 'success').length;
  const approvals = digest.reviewers.filter((reviewer) => reviewer.state === 'approved').length;
  const complete =
    !live.busy &&
    !live.feed.activityUnavailable &&
    !live.feed.checksUnavailable &&
    !live.feed.activityCursor &&
    !live.feed.checksCursor;
  const comments = digest.discussion;
  return (
    <div className="native-digest" aria-busy={live.busy} aria-label="Pull request digest">
      <div className="digest-toolbar">
        <div className="digest-mode" role="group" aria-label="Conversation view">
          <button type="button" aria-pressed={view === 'digest'} onClick={() => setView('digest')}>
            <Sparkles size={14} active={view === 'digest'} />
            Digest
          </button>
          <button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>
            <MessageSquare size={14} active={view === 'timeline'} />
            Timeline
          </button>
        </div>
        <span className="digest-sync" role="status">
          {live.busy ? (
            <>
              <RefreshCw size={12} />
              Updating activity
            </>
          ) : (
            <>
              <Check size={12} />
              At {data.pull.headSha.slice(0, 7)}
            </>
          )}
        </span>
      </div>
      {(live.feed.activityUnavailable || live.feed.checksUnavailable) && (
        <div className="digest-read-error" role="status">
          <span>
            {live.feed.activityUnavailable
              ? 'Some activity could not be loaded.'
              : 'Some checks could not be loaded.'}{' '}
            Available results are shown.
          </span>
          <button type="button" onClick={onChange}>
            Retry
          </button>
        </div>
      )}
      {view === 'timeline' ? (
        <section className="native-timeline" aria-label="Pull request timeline">
          <div className="timeline-description">
            <div className="activity-byline">
              <Avatar name={data.pull.author} src={data.pull.authorAvatar} />
              <strong>{data.pull.author}</strong>
              <span>opened this pull request</span>
            </div>
            <Markdown>{data.pull.body || 'No description provided.'}</Markdown>
          </div>
          <ol className="activity-list">
            {digest.timeline.map((event) => (
              <Event key={event.id} event={event} />
            ))}
          </ol>
          {!digest.timeline.length && (
            <p className="digest-empty">{live.busy ? 'Loading activity…' : 'No activity yet.'}</p>
          )}
          {live.feed.activityCursor && (
            <Button size="sm" variant="outline" disabled={live.busy} onClick={live.more}>
              Load more activity
            </Button>
          )}
          <Group title="Review threads" icon={MessageSquare} count={data.threads.length} open={false}>
            <ReviewThreads
              threads={data.threads}
              reference={data.pull.ref}
              headSha={data.pull.headSha}
              onChange={onChange}
            />
          </Group>
        </section>
      ) : (
        <>
          <section className="digest-summary-plate" aria-label="Review overview">
            <div className="digest-summary-line">
              <span className="digest-mark">
                <Sparkles size={19} />
              </span>
              <div>
                <h2>
                  {digest.openThreads.length
                    ? `${digest.openThreads.length} ${digest.openThreads.length === 1 ? 'thread needs' : 'threads need'} attention`
                    : data.threadsUnavailable
                      ? 'Review threads unavailable'
                      : 'No unresolved review threads'}
                </h2>
                <p>
                  {essential.length} essential {essential.length === 1 ? 'file' : 'files'} ·{' '}
                  {essentialLines.toLocaleString()} changed lines to review
                </p>
              </div>
              <Button size="sm" className="digest-review-button" onClick={onOpenDiff}>
                Review changes <FileCode2 size={14} />
              </Button>
            </div>
            <div className="digest-signal-grid">
              <a href="#digest-checks">
                <CheckCheck size={16} />
                <span>Checks</span>
                <strong>
                  {live.busy && !digest.checks.length
                    ? 'Loading'
                    : digest.checks.length
                      ? `${passed}/${digest.checks.length} passed`
                      : live.feed.checksUnavailable
                        ? 'Unavailable'
                        : 'No checks'}
                </strong>
              </a>
              <a href="#digest-reviewers">
                <Users size={16} />
                <span>Reviews</span>
                <strong>
                  {approvals} approved{complete ? '' : ' · partial'}
                </strong>
              </a>
              <a href="#digest-bots">
                <Sparkles size={16} />
                <span>Review bots</span>
                <strong>{digest.bots.length || 'None'}</strong>
              </a>
            </div>
          </section>
          <section className="digest-description-card">
            <div className="digest-card-heading">
              <h2>Description</h2>
              <span>{data.pull.author}</span>
            </div>
            <Markdown>{data.pull.body || 'No description provided.'}</Markdown>
          </section>
          {digest.meta && (digest.meta.summary || digest.meta.items.length > 0) && (
            <Group
              title="Review summary"
              icon={Sparkles}
              count={digest.meta.headSha === data.pull.headSha ? 'Geld' : 'Earlier commit'}
            >
              {digest.meta.summary && (
                <div className="digest-brief">
                  <Sparkles size={16} />
                  <Markdown>{digest.meta.summary.tldr}</Markdown>
                </div>
              )}
              <div className="digest-findings">
                {digest.meta.items.map((item) => (
                  <article key={item.id}>
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
            </Group>
          )}
          <Group title="Change breakdown" icon={FileCode2} count={`${data.files.length} files`}>
            <div
              className="digest-change-meter"
              role="img"
              aria-label={`${essentialLines} essential changed lines out of ${totalLines}`}
            >
              <span style={{ width: `${totalLines ? (essentialLines / totalLines) * 100 : 100}%` }} />
            </div>
            <div className="digest-change-labels">
              <span>
                <i />
                {essential.length} essential
              </span>
              {categories.map(([category, count]) => (
                <button key={category} type="button" onClick={onOpenDiff}>
                  {count} {category.toLowerCase()}
                </button>
              ))}
              <button type="button" onClick={onOpenDiff}>
                Explore diff
              </button>
            </div>
          </Group>
          <div className="digest-status-columns">
            <Group title="Reviews" icon={Users} count={digest.reviewers.length} id="digest-reviewers">
              {digest.reviewers.length ? (
                digest.reviewers.map((reviewer) => (
                  <div className="digest-person-row" key={reviewer.login}>
                    <Avatar name={reviewer.login} src={reviewer.avatar} />
                    <strong>{reviewer.login}</strong>
                    <Status state={reviewer.state} />
                  </div>
                ))
              ) : (
                <p className="digest-empty">No reviews requested yet.</p>
              )}
              {!complete && digest.reviewers.length > 0 && (
                <p className="digest-footnote">Review states from loaded activity.</p>
              )}
            </Group>
            <Group title="Review bots" icon={Sparkles} count={digest.bots.length} id="digest-bots">
              {digest.bots.length ? (
                digest.bots.map((bot) => {
                  const evidence = digest.timeline.filter(
                    (event) => event.body && botByLogin(event.actor)?.id === bot.id,
                  );
                  return (
                    <Collapsible
                      key={bot.id}
                      className="digest-bot"
                      data-stale={bot.reviewedSha !== data.pull.headSha}
                    >
                      <CollapsibleTrigger
                        className="digest-bot-row"
                        aria-label={`Read ${botById(bot.id)?.title ?? bot.login} review`}
                      >
                        <span className="digest-bot-mark">
                          <CodeXml size={15} />
                        </span>
                        <span className="digest-bot-identity">
                          <strong>{botById(bot.id)?.title ?? bot.login}</strong>
                          {bot.reason && <small>{bot.reason}</small>}
                        </span>
                        <Status state={bot.verdict} />
                        {bot.score !== null && <span className="digest-score">{bot.score}/5</span>}
                        {bot.reviewedSha !== data.pull.headSha && (
                          <small className="digest-earlier">
                            {/^0+$/.test(bot.reviewedSha) ? 'Revision unavailable' : 'Earlier commit'}
                          </small>
                        )}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="digest-bot-evidence">
                        {evidence.length ? (
                          evidence.slice(-3).map((event) => (
                            <div key={event.id}>
                              <Markdown>{event.body}</Markdown>
                            </div>
                          ))
                        ) : (
                          <p className="digest-empty">
                            {bot.verdict === 'running'
                              ? 'The review is still running.'
                              : 'No review comment is available in the loaded activity.'}
                          </p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              ) : (
                <p className="digest-empty">No bot reviews posted yet.</p>
              )}
            </Group>
          </div>
          <Group title="CI checks" icon={CheckCheck} count={digest.checks.length} id="digest-checks">
            {digest.checks.map((check) => (
              <div className="digest-check-row" key={check.id}>
                <span>
                  {check.conclusion === 'success' ? (
                    <Check size={14} />
                  ) : check.conclusion === 'failure' ? (
                    <X size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                </span>
                <strong>{check.name}</strong>
                <Status state={check.conclusion ?? check.status} />
              </div>
            ))}
            {!digest.checks.length && (
              <p className="digest-empty">
                {live.busy
                  ? 'Loading checks…'
                  : live.feed.checksUnavailable
                    ? 'Checks unavailable. Retry to load them.'
                    : 'No checks reported for this commit.'}
              </p>
            )}
            {live.feed.checksCursor && (
              <p className="digest-footnote">The first {digest.checks.length} checks are shown.</p>
            )}
          </Group>
          <Group
            title="Review findings"
            icon={Flag}
            count={
              data.threadsUnavailable
                ? 'Unavailable'
                : digest.openThreads.length
                  ? `${digest.openThreads.length} unresolved`
                  : 'Up to date'
            }
          >
            {children}
            {digest.openThreads.length ? (
              <ReviewThreads
                threads={digest.openThreads}
                reference={data.pull.ref}
                headSha={data.pull.headSha}
                onChange={onChange}
              />
            ) : (
              <p className="digest-empty">
                {data.threadsUnavailable
                  ? 'Review threads could not be loaded.'
                  : 'No unresolved threads. Comments and resolved threads are in Timeline.'}
              </p>
            )}
          </Group>
          <Group title="Discussion" icon={MessageSquare} count={comments.length}>
            <ol className="activity-list digest-recent">
              {comments.slice(-3).map((event) => (
                <Event key={event.id} event={event} />
              ))}
            </ol>
            {!comments.length && <p className="digest-empty">No comments yet.</p>}
            <button
              className="digest-timeline-button"
              type="button"
              onClick={() => {
                setView('timeline');
                document.querySelector('.native-digest')?.scrollIntoView({ block: 'start' });
              }}
            >
              View timeline <MessageSquare size={13} />
            </button>
          </Group>
        </>
      )}
    </div>
  );
}
