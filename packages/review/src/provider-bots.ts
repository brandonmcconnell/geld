import type { BotComment, RawCheckRun } from './bots';
import { botById, commandReply, isReviewShaped, isStatusLineComment, parseBotBody, refusalReason, STATUS_LINE_STALE_MS, verdictsFrom } from './bots';
import type { BotVerdictRecord, ReviewProvider } from './model';
import type { ProviderReviewBot, ProviderReviewCheck, ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from './provider-review';
import { providerReviewKey, providerReviewUrl, sourceLink } from './provider-review';

export interface ProviderBotCapability {
  readonly id: string;
  readonly provider: 'gitlab' | 'bitbucket';
  readonly support: 'supported' | 'unsupported' | 'unverified';
  readonly triggers: readonly string[];
  readonly formatVerified: boolean;
  readonly checkKeys: readonly string[];
  readonly checkMode: 'explicit' | 'none';
  readonly evidence: readonly string[];
}

function capability(id: string, provider: 'gitlab' | 'bitbucket', support: ProviderBotCapability['support'], evidence: readonly string[], triggers: readonly string[] = [], formatVerified = false, checkKeys: readonly string[] = [], checkMode: ProviderBotCapability['checkMode'] = 'explicit'): ProviderBotCapability {
  return { id, provider, support, evidence, triggers, formatVerified, checkKeys, checkMode };
}

const NATIVE_PROVIDERS: readonly ('gitlab' | 'bitbucket')[] = ['gitlab', 'bitbucket'];

export const PROVIDER_BOT_CAPABILITIES: readonly ProviderBotCapability[] = [
  capability('bugbot', 'gitlab', 'supported', ['https://cursor.com/docs/bugbot'], ['bugbot run', 'cursor review']),
  capability('bugbot', 'bitbucket', 'supported', ['https://cursor.com/docs/bugbot'], ['bugbot run', 'cursor review'], false, ['cursor-bugbot']),
  capability('greptile', 'gitlab', 'supported', ['https://www.greptile.com/docs/integrations/code-providers', 'https://www.greptile.com/docs/code-review/developer-essentials', 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272'], ['@greptileai', '@greptile'], true),
  capability('greptile', 'bitbucket', 'supported', ['https://www.greptile.com/docs/integrations/code-providers']),
  capability('devin', 'gitlab', 'supported', ['https://docs.devin.ai/work-with-devin/devin-review#supported-git-providers']),
  capability('devin', 'bitbucket', 'supported', ['https://docs.devin.ai/work-with-devin/devin-review#supported-git-providers']),
  capability('coderabbit', 'gitlab', 'supported', ['https://docs.coderabbit.ai/platforms/gitlab-com', 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117'], ['@coderabbitai review', '@coderabbitai full review'], true),
  capability('coderabbit', 'bitbucket', 'supported', ['https://docs.coderabbit.ai/platforms/bitbucket-cloud/']),
  capability('replicas', 'gitlab', 'supported', ['https://docs.replicas.dev/features/gitlab', 'https://docs.replicas.dev/features/review']),
  capability('replicas', 'bitbucket', 'unverified', ['https://docs.replicas.dev/features/review']),
  capability('sourcery', 'gitlab', 'supported', ['https://docs.sourcery.ai/reviews/commands/', 'https://docs.sourcery.ai/reviews/anatomy-of-a-review/'], ['@sourcery-ai review'], false, [], 'none'),
  capability('sourcery', 'bitbucket', 'unverified', ['https://docs.sourcery.ai/reviews/commands/']),
  capability('qodo', 'gitlab', 'supported', ['https://docs.qodo.ai/qodo-documentation/code-review/get-started/configuration-overview/configuration-file'], ['/agentic_review']),
  capability('qodo', 'bitbucket', 'supported', ['https://docs.qodo.ai/qodo-documentation/code-review/get-started/configuration-overview/configuration-file'], ['/agentic_review']),
  capability('entelligence', 'gitlab', 'unverified', ['https://docs.entelligence.ai/integrations/git-providers']),
  capability('entelligence', 'bitbucket', 'supported', ['https://docs.entelligence.ai/bitbucket-cloud']),
  ...NATIVE_PROVIDERS.flatMap((provider) => [
    capability('codex', provider, 'unverified', ['https://developers.openai.com/codex/integrations/github']),
    capability('copilot', provider, 'unsupported', ['https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/code-review#availability']),
    capability('gemini', provider, 'unverified', ['https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code']),
    capability('capy', provider, 'unverified', ['https://docs.capy.ai/review']),
    capability('claude', provider, 'unsupported', ['https://code.claude.com/docs/en/code-review']),
    capability('cubic', provider, 'unsupported', ['https://docs.cubic.dev/ai-review/introduction']),
    capability('amazon-q', provider, provider === 'gitlab' ? 'unsupported' : 'unverified', ['https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/gitlab-with-amazon-q.html']),
    capability('ellipsis', provider, 'unverified', ['https://www.ellipsis.dev/docs/agents']),
    capability('macroscope', provider, 'unverified', ['https://docs.macroscope.com/welcome']),
    capability('korbit', provider, 'unverified', ['https://www.korbit.ai/']),
  ]),
];

export function providerBotSupport(provider: ReviewProvider, botId: string): ProviderBotCapability | null {
  return PROVIDER_BOT_CAPABILITIES.find((entry) => entry.provider === provider && entry.id === botId) ?? null;
}

function validComment(comment: ProviderReviewComment, input: ProviderReviewInput): boolean {
  return comment.author.id.trim() !== '' && comment.author.login.trim() !== '' && !Number.isNaN(Date.parse(comment.createdAt)) && sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, provider: input.subject.provider, origin: input.subject.origin, url: comment.url }, input.subject) !== null;
}

function parserBody(comment: ProviderReviewComment, input: ProviderReviewInput): string {
  return input.subject.provider === 'gitlab' ? comment.body.replace(/\bmerge request\b/gi, 'pull request') : comment.body;
}

function commentAt(comment: ProviderReviewComment): number {
  const created = Date.parse(comment.createdAt);
  const edited = comment.updatedAt === undefined ? NaN : Date.parse(comment.updatedAt);
  return Number.isNaN(edited) ? created : Math.max(created, edited);
}

function checkAt(check: ProviderReviewCheck): number {
  const started = check.startedAt === undefined ? NaN : Date.parse(check.startedAt);
  const completed = check.completedAt === undefined ? NaN : Date.parse(check.completedAt);
  return Number.isNaN(started) ? (Number.isNaN(completed) ? 0 : completed) : started;
}

function confirmedChecks(input: ProviderReviewInput, bindings: readonly ProviderReviewBot[], support: ProviderBotCapability): readonly ProviderReviewCheck[] {
  if (support.checkMode === 'none') return [];
  return (input.checks ?? []).filter((check) => {
    if (check.authorId === undefined || !/^[0-9a-f]{7,40}$/i.test(check.sha)) return false;
    const binding = bindings.find((candidate) => candidate.authorId === check.authorId);
    if (binding === undefined) return false;
    const associated = check.reviewHeadSha === undefined ? check.sha : check.reviewHeadSha;
    if (associated.toLowerCase() !== input.subject.headSha.toLowerCase()) return false;
    return [...support.checkKeys, ...(binding.checkNames ?? [])].includes(check.key ?? check.name);
  }).sort((a, b) => checkAt(a) - checkAt(b));
}

function plainCommand(body: string): readonly string[] {
  if (body.includes('```')) return [];
  return body.split('\n').map((line) => line.trim().replace(/^[`*_]+|[`*_]+$/g, '').replace(/[.!]+$/, '').replace(/\s+/g, ' ').toLowerCase()).filter((line) => line !== '');
}

function triggerFor(comment: ProviderReviewComment, commands: ReadonlySet<string>): boolean {
  const lines = plainCommand(comment.body);
  return lines.length > 0 && lines.every((line) => commands.has(line));
}

function nativeBotAccounts(input: ProviderReviewInput): { readonly bindings: ReadonlyMap<string, readonly ProviderReviewBot[]>; readonly owners: ReadonlySet<string> } {
  const candidates = new Map<string, ProviderReviewBot[]>();
  const owner = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const binding of input.bots ?? []) {
    const previous = owner.get(binding.authorId);
    if (previous !== undefined && previous !== binding.id) ambiguous.add(binding.authorId);
    owner.set(binding.authorId, binding.id);
    candidates.set(binding.id, [...(candidates.get(binding.id) ?? []), binding]);
  }
  const bindings = new Map<string, readonly ProviderReviewBot[]>();
  for (const [id, entries] of candidates) bindings.set(id, entries.filter((binding) => !ambiguous.has(binding.authorId) && binding.authorId.trim() !== ''));
  return { bindings, owners: new Set(owner.keys()) };
}

function summaryBody(body: string, id: string, support: ProviderBotCapability): boolean {
  const summaryShape = id !== 'greptile' || /\bconfidence score\s*:\s*\d(?:\.\d+)?\s*\/\s*5\b/i.test(body);
  return support.formatVerified && summaryShape && isReviewShaped(parseBotBody(body, id));
}

export function newestProviderBotSummary(input: ProviderReviewInput, ordinaryComments: readonly ProviderReviewComment[], botId: string): ProviderReviewComment | null {
  providerReviewKey(input.subject);
  const registered = nativeBotAccounts(input).bindings.get(botId) ?? [];
  const support = providerBotSupport(input.subject.provider, botId);
  if (registered.length === 0 || support?.support !== 'supported' || !support.formatVerified || botById(botId) === null) return null;
  const ids = new Set(registered.map((binding) => binding.authorId));
  const commands = new Set(support.triggers.map((trigger) => trigger.toLowerCase()));
  const threadAnchors = new Set(input.threads.flatMap((thread) => thread.comments.map((comment) => comment.anchor)));
  const refusalOptions = { isSourceLink: (href: string): boolean => providerCodeSourceLink(href, input.subject) };
  let newest: ProviderReviewComment | null = null;
  for (const comment of ordinaryComments) {
    if (!ids.has(comment.author.id) || threadAnchors.has(comment.anchor) || !validComment(comment, input)) continue;
    const body = parserBody(comment, input);
    if (!summaryBody(body, botId, support) || isStatusLineComment(body) || triggerFor(comment, commands)
      || refusalReason(body, refusalOptions) !== null || (botId === 'coderabbit' && commandReply(body) !== null)) continue;
    if (newest === null || Date.parse(comment.createdAt) > Date.parse(newest.createdAt)) newest = comment;
  }
  return newest;
}

/** Code links are evidence only within this native repository and review. */
export function providerCodeSourceLink(href: string, subject: ProviderReviewSubject): boolean {
  try {
    const page = new URL(providerReviewUrl(subject));
    const url = new URL(href, page);
    if (url.origin !== subject.origin || url.username !== '' || url.password !== '' || !['http:', 'https:'].includes(url.protocol)) return false;
    const repository = `/${subject.repository.split('/').map(encodeURIComponent).join('/')}`;
    if (!url.pathname.startsWith(`${repository}/`)) return false;
    const route = url.pathname.slice(repository.length).replace(/\/$/, '');
    if (subject.provider === 'gitlab') {
      if (route === `/-/merge_requests/${subject.id}/diffs`) return true;
      if (/^\/-\/blob\/[^/]+\/.+/.test(route) || /^\/-\/tree\/[^/]+(?:\/.+)?$/.test(route)) return true;
      if (/^\/-\/commit\/(?:[0-9a-f]{7,40}|[0-9a-f]{64})(?:\.diff)?$/i.test(route)) return true;
      return /^\/-\/compare\/[^/]+\.\.\.[^/]+$/.test(route);
    }
    if (subject.provider === 'bitbucket') {
      if (route === `/pull-requests/${subject.id}/diff` || route === `/pull-requests/${subject.id}/_/diff`) return true;
      return /^\/src\/[^/]+(?:\/.+)?$/.test(route) || /^\/commits\/(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/i.test(route);
    }
    return false;
  } catch { return false; }
}

/** Binding authenticates an account; a body marker, username or GitHub App alias never does. */
export function buildProviderBotVerdicts(input: ProviderReviewInput, ordinaryComments: readonly ProviderReviewComment[]): BotVerdictRecord[] {
  providerReviewKey(input.subject);
  const refusalOptions = { isSourceLink: (href: string): boolean => providerCodeSourceLink(href, input.subject) };
  const { bindings, owners } = nativeBotAccounts(input);
  const out: BotVerdictRecord[] = [];
  for (const [id, registered] of bindings) {
    const support = providerBotSupport(input.subject.provider, id);
    const parser = botById(id);
    const login = parser?.logins[0];
    if (registered.length === 0 || support?.support !== 'supported' || parser === null || login === undefined) continue;
    const ids = new Set(registered.map((binding) => binding.authorId));
    const commands = new Set(support.triggers.map((trigger) => trigger.toLowerCase()));
    const requests = ordinaryComments.filter((comment) => comment.author.automated !== true && !owners.has(comment.author.id) && validComment(comment, input) && triggerFor(comment, commands));
    const native = new Map<string, ProviderReviewComment>();
    const comments: BotComment[] = [];
    const threadAnchors = new Set(input.threads.flatMap((thread) => thread.comments.map((comment) => comment.anchor)));
    const meaningful: number[] = [];
    for (const thread of input.threads) {
      const first = thread.comments[0];
      if (first === undefined || !ids.has(first.author.id) || !validComment(first, input)) continue;
      native.set(first.anchor, first);
      meaningful.push(Date.parse(first.createdAt));
      comments.push({ author: login, body: first.body, anchor: first.anchor, createdAt: first.createdAt, resolved: thread.resolved });
    }
    for (const comment of ordinaryComments) {
      if (!ids.has(comment.author.id) || threadAnchors.has(comment.anchor) || !validComment(comment, input)) continue;
      const body = parserBody(comment, input);
      const status = isStatusLineComment(body);
      const refused = refusalReason(body, refusalOptions);
      const command = id === 'coderabbit' ? commandReply(body) : null;
      const summary = summaryBody(body, id, support);
      if (!status && !(support.formatVerified && (summary || refused !== null || command !== null))) continue;
      native.set(comment.anchor, comment);
      if (summary || refused !== null || command === 'done') meaningful.push(commentAt(comment));
      comments.push({ author: login, body, anchor: comment.anchor, createdAt: comment.createdAt, ...(comment.updatedAt === undefined ? {} : { editedAt: comment.updatedAt }) });
    }
    // Native commands were verified above; Greptile's GitHub-only reaction acknowledgement is deliberately not reused.
    if (parser.acknowledges === undefined) {
      for (const request of requests) comments.push({ author: `native-human:${request.author.id}`, body: request.body, anchor: request.anchor, createdAt: request.createdAt });
    }
    comments.sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? ''));
    const check = confirmedChecks(input, registered, support).at(-1);
    const decisive = check !== undefined && (check.status !== 'completed' || ['success', 'failure', 'timed_out', 'cancelled', 'action_required', 'stale', 'skipped'].includes(check.conclusion ?? ''));
    const checks: RawCheckRun[] = check === undefined || !decisive ? [] : [{ ...check, name: parser.checkNames[0] ?? parser.title, sha: check.reviewHeadSha ?? check.sha }];
    const found = verdictsFrom(checks, comments, input.subject.headSha, [], Date.now(), { ...refusalOptions, complete: input.complete === true, partial: input.complete !== true, closed: input.closed === true }).find((verdict) => verdict.id === id);
    const source = found?.sourceId === undefined ? undefined : native.get(found.sourceId);
    const account = source?.author ?? [...native.values()].at(-1)?.author;
    const binding = registered.find((candidate) => candidate.authorId === check?.authorId) ?? registered[0];
    const nativeLogin = account?.login ?? binding?.login ?? binding?.authorId ?? id;
    let verdict: BotVerdictRecord | undefined = found === undefined ? undefined : {
      ...found,
      login: nativeLogin,
      ...(found.reason === undefined || input.subject.provider !== 'gitlab' ? {} : { reason: found.reason.replace(/\bpull request\b/gi, 'merge request') }),
      ...(check === undefined ? {} : { checkName: check.name, checkSha: check.sha }),
    };
    if (verdict?.verdict === 'findings' && verdict.count === 0 && input.complete !== true) {
      const { count: _count, ...partial } = verdict;
      verdict = partial;
    }
    if (verdict === undefined && check !== undefined) {
      verdict = { id, login: nativeLogin, verdict: 'unknown', reviewedSha: check.reviewHeadSha ?? check.sha, checkName: check.name, checkSha: check.sha };
    }
    const requested = requests.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
    if (requested !== undefined) {
      const askedAt = Date.parse(requested.createdAt);
      const answered = meaningful.some((at) => at >= askedAt) || (check !== undefined && checkAt(check) >= askedAt);
      if (!answered) {
        const running = Date.now() - askedAt <= STATUS_LINE_STALE_MS && input.closed !== true;
        if (running || verdict === undefined) verdict = {
          id, login: nativeLogin, verdict: running ? 'running' : 'unknown',
          reviewedSha: verdict?.reviewedSha ?? input.subject.headSha,
          sourceId: verdict?.sourceId ?? requested.anchor,
          ...(verdict?.checkName === undefined ? {} : { checkName: verdict.checkName }),
          ...(verdict?.checkSha === undefined ? {} : { checkSha: verdict.checkSha }),
        };
      }
    }
    if (verdict !== undefined) out.push(verdict);
  }
  return out;
}
