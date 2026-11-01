import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, ProviderReviewThread, RawCheckRun } from '@geld/review';
import { SUMMARY_MARKER } from '@geld/review';
import { ProviderCiError } from './config';
import { id, isRecord, object, ProviderHttp, sameReviewUrl, sha, text, time } from './http';
import type { OwnedComment, ProviderCiAdapter, ProviderCiReview } from './types';

function author(value: unknown): ProviderReviewAuthor {
  const user = object(value);
  const userId = typeof user.uuid === 'string' && user.uuid !== '' ? user.uuid : typeof user.account_id === 'string' && user.account_id !== '' ? user.account_id : null;
  if (userId === null) throw new ProviderCiError('Bitbucket omitted a durable author identity.');
  return { id: userId, login: typeof user.nickname === 'string' && user.nickname !== '' ? user.nickname : userId };
}

function body(value: unknown, optional = false): string {
  if (optional && (value === null || value === undefined)) return '';
  return text(object(value).raw);
}

function htmlLink(value: unknown): unknown {
  return isRecord(value) && isRecord(value.html) ? value.html.href : null;
}

function markdown(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240).replace(/[\\`*_[\]<>]/g, '\\$&');
}

interface Comment {
  readonly source: ProviderReviewComment;
  readonly parent: string | null;
  readonly resolved: boolean;
  readonly path: string | null;
  readonly line: number | null;
}

interface CommentState {
  readonly parent: string | null;
  readonly resolved: boolean;
  readonly path: string | null;
  readonly line: number | null;
}

export class BitbucketCiAdapter implements ProviderCiAdapter {
  private readonly repositoryPath: string;
  private readonly reviewPath: string;
  private readonly reviewUrl: string;

  constructor(private readonly http: ProviderHttp) {
    const { config } = http;
    if (config.provider !== 'bitbucket') throw new ProviderCiError('Expected a Bitbucket CI configuration.');
    this.repositoryPath = `repositories/${config.repository.split('/').map(encodeURIComponent).join('/')}`;
    this.reviewPath = `${this.repositoryPath}/pullrequests/${config.number}`;
    this.reviewUrl = `${config.origin}/${config.repository.split('/').map(encodeURIComponent).join('/')}/pull-requests/${config.number}`;
  }

  async identity(): Promise<string> {
    return author((await this.http.request('user')).value).id;
  }

  private async pullRequest(): Promise<Record<string, unknown>> {
    const pr = object((await this.http.request(this.reviewPath)).value);
    if (id(pr.id) !== this.http.config.number) throw new ProviderCiError('Bitbucket returned a different pull request.');
    return pr;
  }

  private commit(value: unknown): string {
    return sha(object(object(value).commit).hash);
  }

  async head(): Promise<string> {
    return this.commit((await this.pullRequest()).source);
  }

  private comment(value: unknown): Comment {
    const raw = object(value);
    const number = id(raw.id);
    const url = sameReviewUrl(htmlLink(raw.links), this.reviewUrl);
    if (url === null) throw new ProviderCiError('Bitbucket omitted a canonical review comment link.');
    const anchor = new URL(url).hash.slice(1);
    if (anchor !== `comment-${number}` && anchor !== `comment_${number}`) throw new ProviderCiError('Bitbucket returned a mismatched comment anchor.');
    const inline = isRecord(raw.inline) ? raw.inline : null;
    const line = inline?.to ?? inline?.from;
    if (line !== undefined && line !== null && (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0)) throw new ProviderCiError('Bitbucket returned an invalid comment line.');
    return {
      source: { id: number, anchor, url, author: author(raw.user), body: body(raw.content), createdAt: time(raw.created_on), updatedAt: time(raw.updated_on) },
      parent: raw.parent === undefined || raw.parent === null ? null : id(object(raw.parent).id),
      resolved: raw.resolved === true || isRecord(raw.resolution),
      path: inline === null ? null : text(inline.path), line: typeof line === 'number' ? line : null,
    };
  }

  async load(): Promise<ProviderCiReview> {
    const pr = await this.pullRequest();
    const headSha = this.commit(pr.source);
    const baseSha = this.commit(pr.destination);
    const [rawComments, tasks, activity, statuses] = await Promise.all([
      this.http.bitbucketValues(`${this.reviewPath}/comments`),
      this.http.bitbucketValues(`${this.reviewPath}/tasks`),
      this.http.bitbucketValues(`${this.reviewPath}/activity`),
      this.http.bitbucketValues(`${this.reviewPath}/statuses`),
    ]);
    const owned: OwnedComment[] = [];
    const indexed = new Map<string, Comment>();
    const states = new Map<string, CommentState>();
    for (const value of rawComments) {
      const raw = object(value);
      const number = id(raw.id);
      if (states.has(number)) throw new ProviderCiError('Bitbucket repeated a review comment.');
      const inline = isRecord(raw.inline) ? raw.inline : null;
      const line = inline?.to ?? inline?.from;
      if (line !== undefined && line !== null && (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0)) throw new ProviderCiError('Bitbucket returned an invalid comment line.');
      states.set(number, {
        parent: raw.parent === undefined || raw.parent === null ? null : id(object(raw.parent).id),
        resolved: raw.resolved === true || isRecord(raw.resolution), path: inline === null ? null : text(inline.path), line: typeof line === 'number' ? line : null,
      });
      if (raw.deleted === true) continue;
      const comment = this.comment(raw);
      indexed.set(comment.source.id, comment);
      owned.push({ id: comment.source.id, authorId: comment.source.author.id, body: comment.source.body });
    }
    const groups = new Map<string, Comment[]>();
    for (const comment of indexed.values()) {
      let rootId = comment.source.id;
      let root = states.get(rootId);
      const visited = new Set<string>();
      while (root !== undefined && root.parent !== null) {
        if (visited.has(rootId)) throw new ProviderCiError('Bitbucket returned a comment parent cycle.');
        visited.add(rootId);
        const parent = states.get(root.parent);
        if (parent === undefined) throw new ProviderCiError('Bitbucket omitted a parent comment.');
        rootId = root.parent;
        root = parent;
      }
      const comments = groups.get(rootId) ?? [];
      comments.push(comment);
      groups.set(rootId, comments);
    }
    const threads: ProviderReviewThread[] = [];
    for (const [rootId, comments] of groups) {
      comments.sort((a, b) => Date.parse(a.source.createdAt) - Date.parse(b.source.createdAt));
      const root = states.get(rootId);
      const first = comments[0];
      if (root === undefined || first === undefined || root.path === null && comments.length === 1 && first.parent === null) continue;
      const rootSource = indexed.get(rootId)?.source ?? first.source;
      threads.push({
        id: rootId, anchor: rootSource.anchor, url: rootSource.url, comments: comments.map((comment) => comment.source),
        resolved: root.resolved, outdated: false,
        ...(root.path === null ? {} : { path: root.path }), ...(root.line === null ? {} : { line: root.line }),
      });
    }
    const reviewers: ProviderReviewReviewer[] = [];
    if (!Array.isArray(pr.participants)) throw new ProviderCiError('Bitbucket omitted review participants.');
    for (const value of pr.participants) {
      const participant = object(value);
      if (participant.role !== 'REVIEWER' && participant.approved !== true && participant.state !== 'changes_requested') continue;
      reviewers.push({ author: author(participant.user), state: participant.state === 'changes_requested' ? 'changes_requested' : participant.approved === true ? 'approved' : 'pending' });
    }
    const latestChecks = new Map<string, { readonly at: number; readonly check: RawCheckRun }>();
    for (const value of statuses) {
      const status = object(value);
      const links = object(status.links);
      const self = new URL(text(object(links.self).href));
      const api = new URL(this.http.config.apiBase);
      const prefix = `${api.pathname}/${this.repositoryPath}/commit/`;
      if (self.origin !== api.origin || !self.pathname.startsWith(prefix) || self.username !== '' || self.password !== '') throw new ProviderCiError('Bitbucket returned an untrusted build status source.');
      const commit = /^([a-f0-9]{40})\/statuses(?:\/|$)/i.exec(self.pathname.slice(prefix.length))?.[1];
      if (commit === undefined) throw new ProviderCiError('Bitbucket did not identify a build status commit.');
      if (commit !== headSha) continue;
      const state = text(status.state);
      if (!['SUCCESSFUL', 'FAILED', 'STOPPED', 'INPROGRESS'].includes(state)) throw new ProviderCiError('Bitbucket returned an unknown build state.');
      const key = text(status.key);
      const updatedAt = time(status.updated_on);
      const check: RawCheckRun = {
        name: text(status.name), sha: commit, status: state === 'INPROGRESS' ? 'in_progress' : 'completed',
        conclusion: state === 'INPROGRESS' ? null : state === 'SUCCESSFUL' ? 'success' : state === 'FAILED' ? 'failure' : 'cancelled',
        startedAt: time(status.created_on), ...(state === 'INPROGRESS' ? {} : { completedAt: updatedAt }),
      };
      const previous = latestChecks.get(key);
      if (previous === undefined || previous.at < Date.parse(updatedAt)) latestChecks.set(key, { at: Date.parse(updatedAt), check });
    }
    const notes: string[] = [];
    for (const value of tasks) {
      const task = object(value);
      id(task.id);
      if (task.state !== 'OPEN' && task.state !== 'RESOLVED') throw new ProviderCiError('Bitbucket returned an invalid task state.');
      const parent = task.comment === null || task.comment === undefined ? null : indexed.get(id(object(task.comment).id));
      const url = sameReviewUrl(htmlLink(task.links), this.reviewUrl) ?? parent?.source.url;
      if (url === undefined) throw new ProviderCiError('Bitbucket omitted the source of a task.');
      notes.push(`- [${task.state === 'RESOLVED' ? 'x' : ' '}] Task: ${markdown(body(task.content))} ([source](${url}))`);
    }
    for (const value of activity) object(value);
    const after = await this.pullRequest();
    if (this.commit(after.source) !== headSha || this.commit(after.destination) !== baseSha) throw new ProviderCiError('Bitbucket changed the pull request while the summary was loading.');
    const input: ProviderReviewInput = {
      subject: { provider: 'bitbucket', origin: this.http.config.origin, repository: this.http.config.repository, id: this.http.config.number, headSha },
      threads, reviewers, checks: [...latestChecks.values()].map((entry) => entry.check), bots: [],
    };
    return { input, comments: owned, notes: notes.length === 0 ? [] : ['**Tasks**', ...notes] };
  }

  async upsert(commentId: string | null, summary: string): Promise<void> {
    if (commentId !== null) {
      const [owner, current] = await Promise.all([this.identity(), this.http.request(`${this.reviewPath}/comments/${id(commentId)}`)]);
      const raw = object(current.value);
      if (author(raw.user).id !== owner || !body(raw.content).includes(SUMMARY_MARKER)) throw new ProviderCiError('Refusing to update a Bitbucket comment not owned by the token.');
    }
    await this.http.request(`${this.reviewPath}/comments${commentId === null ? '' : `/${id(commentId)}`}`, commentId === null ? 'POST' : 'PUT', { content: { raw: summary } });
  }
}
