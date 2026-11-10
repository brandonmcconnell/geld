import { z } from 'zod';
import type { ApiTransport } from '@geld/github';
import type { Provider, ProviderActivity, ProviderCheck, ProviderClient, PullRef } from '@geld/domain';

const objectSchema = z.record(z.string(), z.unknown());
const listSchema = z.array(objectSchema);
const pageSchema = z.object({ values: listSchema, next: z.string().optional(), size: z.number().optional() });
const encode = encodeURIComponent;
const object = (value: unknown) => objectSchema.safeParse(value).data ?? {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const identifier = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function person(value: unknown) {
  const user = object(value);
  return {
    actor:
      text(user.login) ||
      text(user.username) ||
      text(user.nickname) ||
      text(user.display_name) ||
      text(user.name) ||
      'Unknown author',
    avatar: text(user.avatar_url) || text(object(object(user.links).avatar).href) || null,
  };
}
function githubEvent(row: Record<string, unknown>, fallback: string): ProviderActivity {
  const event = text(row.event);
  const commit = object(row.commit);
  const actor = person(row.actor ?? row.user ?? row.author);
  const titles: Record<string, string> = {
    commented: 'commented',
    reviewed: 'reviewed the changes',
    committed: 'added a commit',
    closed: 'closed the pull request',
    reopened: 'reopened the pull request',
    merged: 'merged the pull request',
    ready_for_review: 'marked ready for review',
    convert_to_draft: 'converted to draft',
    head_ref_force_pushed: 'force-pushed the branch',
    head_ref_deleted: 'deleted the branch',
    review_dismissed: 'dismissed a review',
    renamed: 'renamed the pull request',
    assigned: 'assigned a collaborator',
    unassigned: 'removed an assignee',
  };
  let title = titles[event] ?? (event.replaceAll('_', ' ') || 'updated the pull request');
  if (event === 'review_requested')
    title = `requested a review from ${person(row.requested_reviewer ?? row.requested_team).actor}`;
  if (event === 'review_request_removed')
    title = `removed the review request for ${person(row.requested_reviewer ?? row.requested_team).actor}`;
  if (event === 'labeled' || event === 'unlabeled')
    title = `${event === 'labeled' ? 'added' : 'removed'} the ${text(object(row.label).name)} label`;
  const kind =
    event === 'commented'
      ? 'comment'
      : event === 'reviewed'
        ? 'review'
        : event === 'committed'
          ? 'commit'
          : 'event';
  return {
    id: `${kind}:${identifier(row.id) || text(row.node_id) || text(row.sha) || fallback}`,
    ...(event === 'review_dismissed'
      ? { targetId: `review:${identifier(object(row.dismissed_review).review_id)}` }
      : {}),
    kind,
    ...actor,
    at: text(row.submitted_at) || text(row.created_at) || text(object(row.committer).date),
    title,
    body: text(row.body) || text(row.message) || text(commit.message),
    state: text(row.state).toLowerCase() || (event === 'review_dismissed' ? 'dismissed' : null),
    sha: text(row.commit_id) || text(row.sha) || null,
  };
}
function gitlabEvent(row: Record<string, unknown>, fallback: string): ProviderActivity {
  const body = text(row.body);
  const system = row.system === true;
  const approval = system && /^(unapproved|approved) this merge request/.test(body);
  return {
    id: `${system ? 'event' : 'comment'}:${identifier(row.id) || fallback}`,
    kind: approval ? 'review' : system ? 'event' : 'comment',
    ...person(row.author),
    at: text(row.created_at),
    title: system ? 'updated the merge request' : 'commented',
    body,
    state: approval ? (body.startsWith('unapproved') ? 'dismissed' : 'approved') : null,
    sha: null,
  };
}
function bitbucketEvent(row: Record<string, unknown>, fallback: string): ProviderActivity {
  const kind = row.comment ? 'comment' : row.approval || row.changes_requested ? 'review' : 'event';
  const value = object(row.comment ?? row.approval ?? row.changes_requested ?? row.update);
  return {
    id: `${kind}:${identifier(value.id) || fallback}`,
    kind,
    ...person(value.user ?? value.author),
    at: text(value.date) || text(value.created_on) || text(value.updated_on),
    title:
      kind === 'comment'
        ? 'commented'
        : kind === 'review'
          ? 'reviewed the changes'
          : 'updated the pull request',
    body: text(object(value.content).raw) || text(value.description),
    state: row.approval
      ? 'approved'
      : row.changes_requested
        ? 'changes_requested'
        : text(value.state).toLowerCase() || null,
    sha: text(object(object(value.source).commit).hash) || null,
  };
}
function check(
  row: Record<string, unknown>,
  sha: string,
  provider: Provider,
  statusContext = false,
): ProviderCheck {
  const raw = text(row.conclusion) || text(row.state) || text(row.status);
  const state = raw.toLowerCase();
  const running = [
    'pending',
    'queued',
    'in_progress',
    'inprogress',
    'running',
    'created',
    'waiting_for_resource',
    'preparing',
    'scheduled',
  ].includes(state);
  const conclusions: Record<string, string> = {
    successful: 'success',
    failed: 'failure',
    error: 'failure',
    canceled: 'cancelled',
    stopped: 'cancelled',
    manual: 'action_required',
  };
  const name = text(row.name) || text(row.context) || text(row.key) || 'Unnamed check';
  return {
    id: `${provider}:${statusContext ? 'status' : 'check'}:${identifier(row.id) || text(row.key) || name}`,
    name,
    status: running ? 'in_progress' : 'completed',
    conclusion: running ? null : (conclusions[state] ?? state) || 'unknown',
    sha: text(row.head_sha) || text(row.sha) || sha,
    description: text(row.description) || text(object(row.output).summary),
    startedAt: text(row.started_at) || text(row.created_at) || text(row.created_on) || null,
    completedAt: running
      ? null
      : text(row.completed_at) ||
        text(row.finished_at) ||
        text(row.updated_at) ||
        text(row.updated_on) ||
        null,
  };
}

export function activityOperations(
  api: ApiTransport,
  provider: Provider,
  host: string,
): Pick<ProviderClient, 'activity' | 'checks'> {
  const owns = (ref: PullRef) => ref.provider === provider && ref.host === host;
  const pageOf = (cursor?: string | null) =>
    !cursor ? 1 : /^[1-9]\d{0,4}$/.test(cursor) ? Number(cursor) : null;
  const base = (ref: PullRef) =>
    provider === 'github'
      ? `repos/${encode(ref.owner)}/${encode(ref.repo)}`
      : provider === 'gitlab'
        ? `projects/${encode(`${ref.owner}/${ref.repo}`)}`
        : `repositories/${encode(ref.owner)}/${encode(ref.repo)}`;
  return {
    async activity(ref, cursor) {
      const page = pageOf(cursor);
      if (!owns(ref) || page === null) return { ok: false, reason: 'invalid_response' };
      const path =
        provider === 'github'
          ? `${base(ref)}/issues/${ref.number}/timeline?per_page=100&page=${page}`
          : provider === 'gitlab'
            ? `${base(ref)}/merge_requests/${ref.number}/notes?sort=asc&order_by=created_at&per_page=100&page=${page}`
            : `${base(ref)}/pullrequests/${ref.number}/activity?pagelen=100&page=${page}`;
      const result = await api.request(path);
      if (!result.ok) return result;
      const values =
        provider === 'bitbucket' ? pageSchema.safeParse(result.value) : listSchema.safeParse(result.value);
      if (!values.success) return { ok: false, reason: 'invalid_response' };
      const rows = Array.isArray(values.data) ? values.data : values.data.values;
      const more = Array.isArray(values.data) ? rows.length === 100 : !!values.data.next;
      return {
        ok: true,
        value: {
          items: rows.map((row, index) =>
            (provider === 'github' ? githubEvent : provider === 'gitlab' ? gitlabEvent : bitbucketEvent)(
              row,
              `${page}:${index}`,
            ),
          ),
          cursor: more ? String(page + 1) : null,
          total: Array.isArray(values.data) ? null : (values.data.size ?? null),
          capped: false,
        },
      };
    },
    async checks(ref, revision, cursor) {
      const page = pageOf(cursor);
      if (!owns(ref) || page === null || !/^[a-f0-9]{40,64}$/i.test(revision))
        return { ok: false, reason: 'invalid_response' };
      if (provider === 'github') {
        const [runs, statuses] = await Promise.all([
          api.request(`${base(ref)}/commits/${revision}/check-runs?per_page=100&page=${page}&filter=latest`),
          api.request(`${base(ref)}/commits/${revision}/statuses?per_page=100&page=${page}`),
        ]);
        if (!runs.ok && !statuses.ok) return runs;
        const runRows = runs.ok
          ? z.object({ check_runs: listSchema }).safeParse(runs.value).data?.check_runs
          : undefined;
        const statusRows = statuses.ok ? listSchema.safeParse(statuses.value).data : undefined;
        if (!runRows && !statusRows) return { ok: false, reason: 'invalid_response' };
        const latestStatuses = [
          ...new Map([...(statusRows ?? [])].reverse().map((row) => [text(row.context), row])).values(),
        ];
        return {
          ok: true,
          value: {
            items: [
              ...(runRows ?? []).map((row) => check(row, revision, provider)),
              ...latestStatuses.map((row) => check(row, revision, provider, true)),
            ],
            cursor: runRows?.length === 100 || statusRows?.length === 100 ? String(page + 1) : null,
            total: null,
            capped: !runRows || !statusRows,
          },
        };
      }
      const path =
        provider === 'gitlab'
          ? `${base(ref)}/repository/commits/${revision}/statuses?per_page=100&page=${page}`
          : `${base(ref)}/commit/${revision}/statuses?pagelen=100&page=${page}`;
      const result = await api.request(path);
      if (!result.ok) return result;
      const parsed =
        provider === 'bitbucket' ? pageSchema.safeParse(result.value) : listSchema.safeParse(result.value);
      if (!parsed.success) return { ok: false, reason: 'invalid_response' };
      const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.values;
      return {
        ok: true,
        value: {
          items: rows.map((row) => check(row, revision, provider)),
          cursor: (Array.isArray(parsed.data) ? rows.length === 100 : !!parsed.data.next)
            ? String(page + 1)
            : null,
          total: null,
          capped: false,
        },
      };
    },
  };
}
