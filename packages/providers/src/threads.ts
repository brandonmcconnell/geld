import { gitlabNoteUrl } from './comment-links';
import { z } from 'zod';
import type { ApiTransport } from '@geld/github';
import type { Provider, ProviderClient, ProviderResult, ProviderThread, PullRef } from '@geld/domain';
const ghComment = z.object({
  id: z.string(),
  databaseId: z.number().int().positive().optional(),
  createdAt: z.string().optional(),
  body: z.string(),
  url: z.string(),
  author: z.object({ login: z.string() }).nullable(),
});
const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});
const ghComments = z.object({
  nodes: z.array(ghComment),
  pageInfo: pageInfo.optional(),
});
const ghThread = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: ghComments,
});
const glNote = z.object({
  id: z.number(),
  created_at: z.string().optional(),
  body: z.string(),
  author: z.object({ username: z.string() }),
  resolved: z.boolean().optional(),
  resolvable: z.boolean().optional(),
  position: z
    .object({
      new_path: z.string(),
      old_path: z.string(),
      new_line: z.number().nullable().optional(),
      old_line: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});
const bbComment = z.object({
  id: z.number(),
  created_on: z.string().optional(),
  content: z.object({ raw: z.string() }),
  user: z.object({ nickname: z.string().optional(), display_name: z.string() }),
  parent: z.object({ id: z.number() }).optional(),
  inline: z
    .object({
      path: z.string(),
      to: z.number().nullable().optional(),
      from: z.number().nullable().optional(),
    })
    .optional(),
  resolution: z.unknown().optional(),
  links: z.object({ html: z.object({ href: z.string() }) }).optional(),
});

export function threadOperations(
  api: ApiTransport,
  graphql: ApiTransport,
  provider: Provider,
  host: string,
): Pick<ProviderClient, 'threads' | 'reply' | 'resolve'> {
  const owns = (ref: PullRef): boolean => ref.provider === provider && ref.host === host;
  const base = (ref: PullRef): string =>
    provider === 'gitlab'
      ? `projects/${encodeURIComponent(`${ref.owner}/${ref.repo}`)}/merge_requests/${ref.number}`
      : `repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pullrequests/${ref.number}`;
  async function threads(ref: PullRef): Promise<ProviderResult<readonly ProviderThread[]>> {
    if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
    if (provider === 'github') {
      const all: z.infer<typeof ghThread>[] = [];
      let cursor: string | null = null;
      let complete = false;
      for (let page = 0; page < 20; page++) {
        const result = await graphql.request('graphql', {
          method: 'POST',
          body: {
            query:
              'query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id path line isResolved isOutdated comments(first:100){pageInfo{hasNextPage endCursor} nodes{id databaseId createdAt body url author{login}}}}}}}}',
            variables: {
              owner: ref.owner,
              repo: ref.repo,
              number: ref.number,
              after: cursor,
            },
          },
        });
        if (!result.ok) return result;
        const parsed = z
          .object({
            data: z.object({
              repository: z.object({
                pullRequest: z.object({
                  reviewThreads: z.object({
                    nodes: z.array(ghThread),
                    pageInfo: pageInfo.optional(),
                  }),
                }),
              }),
            }),
            errors: z.array(z.unknown()).optional(),
          })
          .safeParse(result.value);
        if (!parsed.success || parsed.data.errors?.length) return { ok: false, reason: 'invalid_response' };
        const connection = parsed.data.data.repository.pullRequest.reviewThreads;
        all.push(...connection.nodes);
        if (!connection.pageInfo?.hasNextPage) {
          if (!connection.pageInfo && connection.nodes.length === 100) return { ok: false, reason: 'invalid_response' };
          complete = true;
          break;
        }
        if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor)
          return { ok: false, reason: 'invalid_response' };
        cursor = connection.pageInfo.endCursor;
      }
      if (!complete) return { ok: false, reason: 'unavailable' };
      const threads: ProviderThread[] = [];
      for (const thread of all) {
        const comments = [...thread.comments.nodes];
        let connection = thread.comments;
        let after = connection.pageInfo?.endCursor;
        let pages = 0;
        while (connection.pageInfo?.hasNextPage) {
          if (!after || pages++ >= 10) return { ok: false, reason: 'unavailable' };
          const result = await graphql.request('graphql', {
            method: 'POST',
            body: {
              query:
                'query($id:ID!,$after:String!){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id databaseId createdAt body url author{login}}}}}}',
              variables: { id: thread.id, after },
            },
          });
          if (!result.ok) return result;
          const parsed = z
            .object({
              data: z.object({ node: z.object({ comments: ghComments }) }),
              errors: z.array(z.unknown()).optional(),
            })
            .safeParse(result.value);
          if (!parsed.success || parsed.data.errors?.length) return { ok: false, reason: 'invalid_response' };
          connection = parsed.data.data.node.comments;
          comments.push(...connection.nodes);
          if (connection.pageInfo?.hasNextPage && connection.pageInfo.endCursor === after)
            return { ok: false, reason: 'invalid_response' };
          after = connection.pageInfo?.endCursor;
        }
        if (!connection.pageInfo && connection.nodes.length === 100) return { ok: false, reason: 'invalid_response' };
        threads.push({
          id: thread.id,
          path: thread.path,
          line: thread.line,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
          comments: comments.map((comment) => ({
            id: comment.id,
            author: comment.author?.login ?? 'unknown',
            body: comment.body,
            path: thread.path,
            line: thread.line,
            url: comment.url,
            ...(comment.databaseId ? { databaseId: comment.databaseId } : {}),
            ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
          })),
        });
      }
      return { ok: true, value: threads };
    }
    const entries: unknown[] = [];
    let complete = false;
    for (let page = 1; page <= 20; page++) {
      const result = await api.request(
        `${base(ref)}/${provider === 'gitlab' ? `discussions?per_page=100&page=${page}` : `comments?pagelen=100&page=${page}`}`,
      );
      if (!result.ok) return result;
      if (provider === 'gitlab') {
        const parsed = z.array(z.unknown()).safeParse(result.value);
        if (!parsed.success) return { ok: false, reason: 'invalid_response' };
        entries.push(...parsed.data);
        if (parsed.data.length < 100) {
          complete = true;
          break;
        }
      } else {
        const parsed = z.object({ values: z.array(z.unknown()), next: z.string().optional() }).safeParse(result.value);
        if (!parsed.success) return { ok: false, reason: 'invalid_response' };
        entries.push(...parsed.data.values);
        if (!parsed.data.next) {
          complete = true;
          break;
        }
      }
    }
    if (!complete) return { ok: false, reason: 'unavailable' };
    if (provider === 'gitlab') {
      const parsed = z.array(z.object({ id: z.string(), notes: z.array(glNote) })).safeParse(entries);
      if (!parsed.success) return { ok: false, reason: 'invalid_response' };
      return {
        ok: true,
        value: parsed.data
          .filter((thread) => thread.notes.some((note) => note.position))
          .map((thread) => ({
            id: thread.id,
            path: thread.notes.find((note) => note.position)?.position?.new_path ?? null,
            line:
              thread.notes.find((note) => note.position)?.position?.new_line ??
              thread.notes.find((note) => note.position)?.position?.old_line ??
              null,
            resolved: thread.notes
              .filter((note) => note.position || note.resolvable)
              .every((note) => note.resolved === true),
            outdated: false,
            comments: thread.notes.map((note) => ({
              id: String(note.id),
              author: note.author.username,
              body: note.body,
              path: note.position?.new_path ?? null,
              line: note.position?.new_line ?? note.position?.old_line ?? null,
              url: gitlabNoteUrl(ref, note.id),
              databaseId: note.id,
              ...(note.created_at ? { createdAt: note.created_at } : {}),
            })),
          })),
      };
    }
    const parsed = z.object({ values: z.array(bbComment) }).safeParse({ values: entries });
    if (!parsed.success) return { ok: false, reason: 'invalid_response' };
    const byId = new Map(parsed.data.values.map((comment) => [comment.id, comment]));
    const rootId = (comment: z.infer<typeof bbComment>): number | null => {
      const seen = new Set<number>();
      while (comment.parent) {
        if (seen.has(comment.id) || seen.size >= 30) return null;
        seen.add(comment.id);
        const parent = byId.get(comment.parent.id);
        if (!parent) return null;
        comment = parent;
      }
      return comment.id;
    };
    return {
      ok: true,
      value: parsed.data.values
        .filter((comment) => comment.inline && !comment.parent)
        .map((root) => ({
          id: String(root.id),
          path: root.inline?.path ?? null,
          line: root.inline?.to ?? root.inline?.from ?? null,
          resolved: root.resolution !== undefined && root.resolution !== null,
          outdated: false,
          comments: [
            root,
            ...parsed.data.values.filter((comment) => comment.id !== root.id && rootId(comment) === root.id),
          ].map((comment) => ({
            id: String(comment.id),
            author: comment.user.nickname ?? comment.user.display_name,
            body: comment.content.raw,
            path: root.inline?.path ?? null,
            line: root.inline?.to ?? root.inline?.from ?? null,
            url: comment.links?.html.href ?? '',
            databaseId: comment.id,
            ...(comment.created_on ? { createdAt: comment.created_on } : {}),
          })),
        })),
    };
  }
  async function mutate(
    ref: PullRef,
    threadId: string,
    operation: 'reply' | 'resolve',
    value: string | boolean,
  ): Promise<ProviderResult<void>> {
    const existing = await threads(ref);
    if (!existing.ok) return existing;
    if (!existing.value.some((thread) => thread.id === threadId)) return { ok: false, reason: 'not_found' };
    let result;
    if (provider === 'github') {
      const name =
        operation === 'reply'
          ? 'addPullRequestReviewThreadReply'
          : value
            ? 'resolveReviewThread'
            : 'unresolveReviewThread';
      const query =
        operation === 'reply'
          ? 'mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}'
          : `mutation($id:ID!){${name}(input:{threadId:$id}){thread{id}}}`;
      result = await graphql.request('graphql', {
        method: 'POST',
        body: {
          query,
          variables: {
            id: threadId,
            ...(operation === 'reply' ? { body: value } : {}),
          },
        },
      });
      if (!result.ok) return result;
      const parsed = z
        .object({
          data: z.record(z.string(), z.unknown()),
          errors: z.array(z.unknown()).optional(),
        })
        .safeParse(result.value);
      if (!parsed.success || parsed.data.errors?.length || !parsed.data.data[name])
        return {
          ok: false,
          reason: 'permission',
          required: 'pull_requests=write',
          url: null,
        };
    } else {
      const path =
        provider === 'gitlab'
          ? `${base(ref)}/discussions/${encodeURIComponent(threadId)}${operation === 'reply' ? '/notes' : ''}`
          : `${base(ref)}/comments${operation === 'resolve' ? `/${encodeURIComponent(threadId)}/resolve` : ''}`;
      result = await api.request(path, {
        method:
          operation === 'reply' || (provider === 'bitbucket' && value)
            ? 'POST'
            : provider === 'bitbucket'
              ? 'DELETE'
              : 'PUT',
        ...(operation === 'reply'
          ? {
              body:
                provider === 'gitlab'
                  ? { body: value }
                  : {
                      content: { raw: value },
                      parent: { id: Number(threadId) },
                    },
            }
          : provider === 'gitlab'
            ? { body: { resolved: value } }
            : {}),
      });
      if (!result.ok) return result;
    }
    return { ok: true, value: undefined };
  }
  return {
    threads,
    reply: (ref, id, body) => mutate(ref, id, 'reply', body),
    resolve: (ref, id, resolved) => mutate(ref, id, 'resolve', resolved),
  };
}
