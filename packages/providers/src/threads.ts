import { z } from 'zod';
import type { ApiTransport } from '@geld/github';
import type { Provider, ProviderClient, ProviderResult, ProviderThread, PullRef } from '@geld/domain';
const ghComment = z.object({ id: z.string(), body: z.string(), url: z.string(), author: z.object({ login: z.string() }).nullable() });
const ghThread = z.object({ id: z.string(), path: z.string(), line: z.number().nullable(), isResolved: z.boolean(), isOutdated: z.boolean(), comments: z.object({ nodes: z.array(ghComment) }) });
const glNote = z.object({ id: z.number(), body: z.string(), author: z.object({ username: z.string() }), resolved: z.boolean().optional(), position: z.object({ new_path: z.string(), old_path: z.string(), new_line: z.number().nullable().optional(), old_line: z.number().nullable().optional() }).nullable().optional() });
const bbComment = z.object({ id: z.number(), content: z.object({ raw: z.string() }), user: z.object({ nickname: z.string().optional(), display_name: z.string() }), parent: z.object({ id: z.number() }).optional(), inline: z.object({ path: z.string(), to: z.number().nullable().optional(), from: z.number().nullable().optional() }).optional(), resolution: z.unknown().optional(), links: z.object({ html: z.object({ href: z.string() }) }).optional() });

export function threadOperations(api: ApiTransport, graphql: ApiTransport, provider: Provider, host: string): Pick<ProviderClient, 'threads' | 'reply' | 'resolve'> {
  const owns = (ref: PullRef): boolean => ref.provider === provider && ref.host === host;
  const base = (ref: PullRef): string => provider === 'gitlab' ? `projects/${encodeURIComponent(`${ref.owner}/${ref.repo}`)}/merge_requests/${ref.number}` : `repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pullrequests/${ref.number}`;
  async function threads(ref: PullRef): Promise<ProviderResult<readonly ProviderThread[]>> {
    if (!owns(ref)) return { ok: false, reason: 'invalid_response' };
    if (provider === 'github') {
      const result = await graphql.request('graphql', { method: 'POST', body: { query: 'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id path line isResolved isOutdated comments(first:100){nodes{id body url author{login}}}}}}}}', variables: { owner: ref.owner, repo: ref.repo, number: ref.number } } });
      if (!result.ok) return result;
      const parsed = z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({ reviewThreads: z.object({ nodes: z.array(ghThread) }) }) }) }) }).safeParse(result.value);
      if (!parsed.success) return { ok: false, reason: 'invalid_response' };
      return { ok: true, value: parsed.data.data.repository.pullRequest.reviewThreads.nodes.map((thread) => ({ id: thread.id, path: thread.path, line: thread.line, resolved: thread.isResolved, outdated: thread.isOutdated, comments: thread.comments.nodes.map((comment) => ({ id: comment.id, author: comment.author?.login ?? 'unknown', body: comment.body, path: thread.path, line: thread.line, url: comment.url })) })) };
    }
    const result = await api.request(`${base(ref)}/${provider === 'gitlab' ? 'discussions?per_page=100' : 'comments?pagelen=100'}`);
    if (!result.ok) return result;
    if (provider === 'gitlab') {
      const parsed = z.array(z.object({ id: z.string(), notes: z.array(glNote) })).safeParse(result.value);
      if (!parsed.success) return { ok: false, reason: 'invalid_response' };
      return { ok: true, value: parsed.data.filter((thread) => thread.notes.some((note) => note.position)).map((thread) => ({ id: thread.id, path: thread.notes[0]?.position?.new_path ?? null, line: thread.notes[0]?.position?.new_line ?? thread.notes[0]?.position?.old_line ?? null, resolved: thread.notes.every((note) => note.resolved === true), outdated: false, comments: thread.notes.map((note) => ({ id: String(note.id), author: note.author.username, body: note.body, path: note.position?.new_path ?? null, line: note.position?.new_line ?? note.position?.old_line ?? null, url: '' })) })) };
    }
    const parsed = z.object({ values: z.array(bbComment) }).safeParse(result.value);
    if (!parsed.success) return { ok: false, reason: 'invalid_response' };
    return { ok: true, value: parsed.data.values.filter((comment) => comment.inline && !comment.parent).map((root) => ({ id: String(root.id), path: root.inline?.path ?? null, line: root.inline?.to ?? root.inline?.from ?? null, resolved: root.resolution !== undefined && root.resolution !== null, outdated: false, comments: [root, ...parsed.data.values.filter((comment) => comment.parent?.id === root.id)].map((comment) => ({ id: String(comment.id), author: comment.user.nickname ?? comment.user.display_name, body: comment.content.raw, path: root.inline?.path ?? null, line: root.inline?.to ?? root.inline?.from ?? null, url: comment.links?.html.href ?? '' })) })) };
  }
  async function mutate(ref: PullRef, threadId: string, operation: 'reply' | 'resolve', value: string | boolean): Promise<ProviderResult<void>> {
    const existing = await threads(ref);
    if (!existing.ok) return existing;
    if (!existing.value.some((thread) => thread.id === threadId)) return { ok: false, reason: 'not_found' };
    let result;
    if (provider === 'github') {
      const name = operation === 'reply' ? 'addPullRequestReviewThreadReply' : value ? 'resolveReviewThread' : 'unresolveReviewThread';
      const query = operation === 'reply' ? 'mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}' : `mutation($id:ID!){${name}(input:{threadId:$id}){thread{id}}}`;
      result = await graphql.request('graphql', { method: 'POST', body: { query, variables: { id: threadId, ...(operation === 'reply' ? { body: value } : {}) } } });
      if (!result.ok) return result;
      const parsed = z.object({ data: z.record(z.string(), z.unknown()), errors: z.array(z.unknown()).optional() }).safeParse(result.value);
      if (!parsed.success || parsed.data.errors?.length || !parsed.data.data[name]) return { ok: false, reason: 'permission', required: 'pull_requests=write', url: null };
    } else {
      const path = provider === 'gitlab' ? `${base(ref)}/discussions/${encodeURIComponent(threadId)}${operation === 'reply' ? '/notes' : ''}` : `${base(ref)}/comments${operation === 'resolve' ? `/${encodeURIComponent(threadId)}/resolve` : ''}`;
      result = await api.request(path, { method: operation === 'reply' || (provider === 'bitbucket' && value) ? 'POST' : provider === 'bitbucket' ? 'DELETE' : 'PUT', ...(operation === 'reply' ? { body: provider === 'gitlab' ? { body: value } : { content: { raw: value }, parent: { id: Number(threadId) } } } : provider === 'gitlab' ? { body: { resolved: value } } : {}) });
      if (!result.ok) return result;
    }
    return { ok: true, value: undefined };
  }
  return { threads, reply: (ref, id, body) => mutate(ref, id, 'reply', body), resolve: (ref, id, resolved) => mutate(ref, id, 'resolve', resolved) };
}
