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

interface ResolvedCommit {
  readonly hash: string;
  readonly repository: string;
}

interface ReviewRevision {
  readonly source: ResolvedCommit;
  readonly destination: ResolvedCommit;
}

export class BitbucketCiAdapter implements ProviderCiAdapter {
  private readonly repositoryPath: string;
  private readonly reviewPath: string;
  private readonly reviewUrl: string;
  private loadedRevision: ReviewRevision | null = null;

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

  private repository(value: unknown): string {
    const name = text(object(value).full_name);
    const parts = name.split('/');
    if (parts.length !== 2 || parts.some((part) => part === '' || part === '.' || part === '..' || /[\s\\?#%\u0000-\u001f]/.test(part))) throw new ProviderCiError('Bitbucket returned an invalid commit repository.');
    return name;
  }

  private commitPath(repository: string): string {
    return `repositories/${repository.split('/').map(encodeURIComponent).join('/')}/commit/`;
  }

  private reference(value: unknown): string {
    const reference = text(value);
    if (!/^[a-f0-9]{7,40}$/i.test(reference)) throw new ProviderCiError('Bitbucket returned an invalid commit reference.');
    return reference.toLowerCase();
  }

  private selfReference(value: unknown, repository: string): string | null {
    if (value === undefined || value === null) return null;
    const links = object(value);
    if (links.self === undefined) return null;
    const url = new URL(text(object(links.self).href));
    const api = new URL(this.http.config.apiBase);
    const prefix = `${api.pathname}/${this.commitPath(repository)}`;
    if (url.origin !== api.origin || url.username !== '' || url.password !== '' || url.hash !== '' || url.search !== '' || !url.pathname.startsWith(prefix)) throw new ProviderCiError('Bitbucket returned an untrusted commit source.');
    return this.reference(url.pathname.slice(prefix.length));
  }

  private async resolveReference(reference: string, repository: string, selfReference: string | null = null): Promise<ResolvedCommit> {
    let full = reference;
    if (reference.length < 40) {
      const response = object((await this.http.request(`${this.commitPath(repository)}${reference}?fields=hash`)).value);
      full = sha(response.hash).toLowerCase();
      if (response.repository !== undefined && this.repository(response.repository) !== repository) throw new ProviderCiError('Bitbucket resolved the commit in a different repository.');
      if (response.type !== undefined && response.type !== 'commit') throw new ProviderCiError('Bitbucket did not resolve a commit.');
      const resolvedSelf = this.selfReference(response.links, repository);
      if (resolvedSelf !== null && !full.startsWith(resolvedSelf)) throw new ProviderCiError('Bitbucket returned a mismatched resolved commit link.');
    }
    full = sha(full).toLowerCase();
    if (!full.startsWith(reference) || selfReference !== null && !full.startsWith(selfReference)) throw new ProviderCiError('Bitbucket resolved a different commit reference.');
    return { hash: full, repository };
  }

  private async commit(value: unknown, destination: boolean): Promise<ResolvedCommit> {
    const ref = object(value);
    const commit = object(ref.commit);
    const reference = this.reference(commit.hash);
    const repository = ref.repository === undefined && reference.length === 40 ? this.http.config.repository : this.repository(ref.repository);
    if (destination && repository !== this.http.config.repository) throw new ProviderCiError('Bitbucket returned a different destination repository.');
    if (commit.type !== undefined && commit.type !== 'commit') throw new ProviderCiError('Bitbucket returned a non-commit reference.');
    const self = this.selfReference(commit.links, repository);
    return this.resolveReference(reference, repository, self);
  }

  private async revision(pr: Record<string, unknown>): Promise<ReviewRevision> {
    const [source, destination] = await Promise.all([this.commit(pr.source, false), this.commit(pr.destination, true)]);
    return { source, destination };
  }

  private sameRevision(a: ReviewRevision, b: ReviewRevision): boolean {
    return a.source.hash === b.source.hash && a.source.repository === b.source.repository && a.destination.hash === b.destination.hash && a.destination.repository === b.destination.repository;
  }

  async head(): Promise<string> {
    const current = await this.revision(await this.pullRequest());
    if (this.loadedRevision !== null && !this.sameRevision(this.loadedRevision, current)) throw new ProviderCiError('Bitbucket changed the pull request before the summary could be written.');
    return current.source.hash;
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
    this.loadedRevision = null;
    const pr = await this.pullRequest();
    const before = await this.revision(pr);
    const headSha = before.source.hash;
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
      const repositories = new Set([before.source.repository, before.destination.repository]);
      const repository = [...repositories].find((path) => self.pathname.startsWith(`${api.pathname}/${this.commitPath(path)}`));
      if (self.origin !== api.origin || repository === undefined || self.username !== '' || self.password !== '' || self.hash !== '' || self.search !== '') throw new ProviderCiError('Bitbucket returned an untrusted build status source.');
      const prefix = `${api.pathname}/${this.commitPath(repository)}`;
      const reference = /^([a-f0-9]{7,40})\/statuses(?:\/|$)/i.exec(self.pathname.slice(prefix.length))?.[1];
      if (reference === undefined) throw new ProviderCiError('Bitbucket did not identify a build status commit.');
      const commit = await this.resolveReference(reference.toLowerCase(), repository);
      if (commit.hash !== headSha) continue;
      const state = text(status.state);
      if (!['SUCCESSFUL', 'FAILED', 'STOPPED', 'INPROGRESS'].includes(state)) throw new ProviderCiError('Bitbucket returned an unknown build state.');
      const key = text(status.key);
      const updatedAt = time(status.updated_on);
      const check: RawCheckRun = {
        name: text(status.name), sha: commit.hash, status: state === 'INPROGRESS' ? 'in_progress' : 'completed',
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
    const after = await this.revision(await this.pullRequest());
    if (!this.sameRevision(before, after)) throw new ProviderCiError('Bitbucket changed the pull request while the summary was loading.');
    this.loadedRevision = after;
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
