import type { GeldSettings } from '@geld/core';
import type { GeldPrMeta, ProviderReviewComment, ProviderReviewInput, RawComment, ReviewItem } from '@geld/review';
import { agentTask, META_VERSION, openTargetById, providerReviewKey, providerReviewUrl } from '@geld/review';
import type { AiState, SuggestionSource, SuggestionTarget } from '../review/ai';
import { aiPending, aiStateFor, discardSuggestion, leaveAiPage, loadAiForPage, onAiKeyChange, runAi, threadKeyOf, triageNoteFor, triageSuggestions, withAi } from '../review/ai';
import type { HandOff, TriageHandlers, TriageSkin, TriageView } from '../review/triage-card';
import { aiButton, triageCard } from '../review/triage-card';
import { buildTriageView } from '../review/triage-view';
import { copyText } from '../github/review/actions';
import { copyTask, openTask } from '../review/handoff';
import { chatFixes } from '../review/chat-fix-controller';
import { runFixes } from '../review/apply-runner';
import type { FixApplier } from '../review/apply-fixes';
import type { AskedChatFix, ChatFixThreadLink } from '../review/chat-fix-controller';
import type { ChatFix, CommentFix } from '../review/chat-fix';
import { createElement } from '../github/dom';
import './triage.css';

/** What the provider's page lends the triage: the review's words, and a changed file's lines at the head. */
export interface ProviderTriageServices {
  readonly openSettings?: () => Promise<void>;
  readonly pullIntent?: () => { readonly title: string; readonly description: string };
  readonly headLines?: (path: string) => Promise<readonly string[] | null>;
  readonly reportMissingTool?: (tool: 'review bot' | 'coding agent') => void;
  /** Commits fixes the host's own way (GitLab's suggestions API); absent where Geld cannot yet (Bitbucket). */
  readonly fixApplier?: (subject: ProviderReviewInput['subject'], threads: () => readonly ProviderReviewInput['threads'][number][]) => FixApplier;
  /** Read the review again after a fix was posted, so its note and the resolved thread show. */
  readonly refresh?: () => void;
}

const SKIN: TriageSkin = { button: 'geld-provider-toggle', primary: 'geld-provider-toggle geld-provider-toggle--primary', counter: 'geld-provider-counter' };

/** Bitbucket has no request that commits a suggestion, so a fix there is handed to an agent or copied. */

function rawComments(input: ProviderReviewInput, comments: readonly ProviderReviewComment[]): readonly RawComment[] {
  const output = new Map<string, RawComment>();
  for (const comment of comments) output.set(comment.anchor, { anchor: comment.anchor, author: comment.author.login, authorId: comment.author.id, body: comment.body, createdAt: comment.createdAt, kind: 'comment' });
  for (const thread of input.threads) for (const comment of thread.comments) output.set(comment.anchor, {
    anchor: comment.anchor, author: comment.author.login, authorId: comment.author.id, body: comment.body,
    createdAt: comment.createdAt, kind: 'thread', ...(thread.path === undefined ? {} : { path: thread.path }),
    ...(thread.line === undefined ? {} : { line: thread.line }), ...(thread.outdated ? { isOutdated: true } : {}),
  });
  return [...output.values()];
}

/**
 * GitLab's and Bitbucket's side of the shared AI triage (`review/ai.ts`, `review/triage-card.ts`): the review as the
 * engine reads it, the same AI control and card GitHub's digest shows, and what each control does here. Fixes are
 * proposed and previewed as on GitHub; applying one stays GitHub's for now, so Apply says so and the finding can be
 * copied as a task for an agent instead.
 */
export class ProviderTriage {
  private key = '';
  private meta: GeldPrMeta | null = null;
  private comments: readonly RawComment[] = [];
  private settings: GeldSettings | null = null;
  private input: ProviderReviewInput | null = null;
  private readonly visit: { openKey: string | null; collapsed: boolean; busy: Map<string, 'fix' | 'writing'>; errors: Map<string, string>; handedOff: TriageView['handedOff']; chatFixes: Map<string, AskedChatFix> } = { openKey: null, collapsed: false, busy: new Map(), errors: new Map(), handedOff: null, chatFixes: new Map() };

  constructor(private readonly changed: () => void, private readonly services: ProviderTriageServices = {}) {
    onAiKeyChange(() => this.changed());
  }

  /** Point the engine at this review and hand it the items as the digest builds them. */
  sync(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], items: readonly ReviewItem[], settings: GeldSettings): void {
    const key = `provider:${providerReviewKey(input.subject)}`;
    if (key !== this.key) {
      this.key = key;
      this.visit.openKey = null;
      this.visit.collapsed = false;
      this.visit.busy.clear();
      this.visit.errors.clear();
      this.visit.handedOff = null;
      this.visit.chatFixes.clear();
      loadAiForPage(key, () => this.changed());
    }
    this.input = input;
    this.settings = settings;
    this.comments = rawComments(input, comments);
    this.meta = { v: META_VERSION, generatedAt: new Date(0).toISOString(), headSha: input.subject.headSha, producer: { kind: 'crawler', version: '1', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] } };
  }

  /** The review is gone (navigation, the digest torn down): a late answer is dropped and the next review loads afresh. */
  clear(): void {
    if (this.key === '') return;
    this.key = '';
    this.meta = null;
    this.input = null;
    leaveAiPage();
  }

  /** The items with the model's wording laid over them. */
  items(items: readonly ReviewItem[]): readonly ReviewItem[] {
    return this.meta === null ? items : withAi({ ...this.meta, items }).items;
  }

  state(): AiState {
    return this.meta === null || this.settings === null ? { kind: 'off' } : aiStateFor(this.meta, this.comments, this.settings);
  }

  summary(): string | undefined {
    return this.meta === null ? undefined : withAi(this.meta).summary?.tldr;
  }

  pending(): ReadonlySet<string> {
    return aiPending();
  }

  /** What the panel compares to know the triage changed. */
  signature(): unknown {
    const state = this.state();
    const meta = this.meta === null ? null : withAi(this.meta);
    return [state, [...aiPending()], meta?.summary?.tldr, this.view(state), this.visit.openKey, this.visit.collapsed, [...this.visit.chatFixes]];
  }

  /** A thread's and a comment's Fix in the digest's chats, as GitHub's: written by the same engine, shown in the triage. */
  chatFix(): { readonly thread: (anchor: string) => ChatFix | null; readonly comment: (anchor: string, author: string, links: readonly ChatFixThreadLink[]) => CommentFix | null } | null {
    if (this.meta === null || this.settings === null) return null;
    const fixes = chatFixes({
      meta: this.meta, comments: this.comments, settings: this.settings,
      visit: () => this.visit, reapply: () => this.changed(), source: () => this.source(),
      openAiSettings: () => void this.services.openSettings?.(),
    });
    return { thread: fixes.threadFix, comment: fixes.commentFix };
  }

  button(): HTMLElement | null {
    const button = aiButton(this.state(), this.handlers());
    // The provider's own tool button, with the shared control's classes and the token bridge for its colours.
    button?.classList.add('geld-provider-review__tool', 'geld-primer-bridge', 'geld-review-tokens');
    return button;
  }

  card(): HTMLElement | null {
    if (this.meta === null) return null;
    const state = this.state();
    const meta = withAi(this.meta);
    const card = triageCard({ ai: state, triage: this.view(state), aiPending: aiPending(), meta }, this.handlers(), SKIN);
    return card === null ? null : createElement('div', { class: 'geld-review-tokens geld-primer-bridge geld-provider-triage' }, [card]);
  }

  private view(state: AiState): TriageView | null {
    if (this.meta === null || this.settings === null) return null;
    const view = buildTriageView({
      meta: this.meta, ai: state, settings: this.settings, knownBots: new Set(),
      viewerIsAuthor: false, agentServices: [], visit: this.visit,
      resolves: this.applier() !== null && this.settings.resolveOnFix, policyPending: false, host: 'other',
    });
    // The agents' comment commands are GitHub's: here a task is copied or opened in an agent whose link carries it alone.
    return view === null ? null : { ...view, agents: [], recommended: null, ...(this.applier() === null ? { cannotApply: true } : {}) };
  }

  private applier(): FixApplier | null {
    const input = this.input;
    return input === null || this.services.fixApplier === undefined ? null : this.services.fixApplier(input.subject, () => this.input?.threads ?? []);
  }

  /** Apply fixes as GitHub's Apply does (`review/apply-runner.ts`): posted, committed together, their threads resolved. */
  private apply(keys: readonly string[]): void {
    const applier = this.applier();
    const meta = this.meta, settings = this.settings;
    if (applier === null || meta === null || settings === null) return;
    runFixes(keys, {
      meta, comments: this.comments, settings, visit: this.visit, reapply: () => this.changed(),
      applier: { ...applier, afterPost: async () => { this.services.refresh?.(); } },
      resolves: () => this.settings?.resolveOnFix ?? settings.resolveOnFix,
    });
  }

  private source(): SuggestionSource | null {
    const lines = this.services.headLines;
    if (lines === undefined) return null;
    const pull = this.services.pullIntent?.() ?? { title: '', description: '' };
    return {
      pull,
      target: async (item): Promise<SuggestionTarget | null> => {
        const thread = this.input?.threads.find((each) => each.comments[0]?.anchor === threadKeyOf(item));
        if (thread === undefined || thread.outdated || thread.side === 'old' || thread.path === undefined || thread.line === undefined) return null;
        const file = await lines(thread.path);
        return file === null || thread.line > file.length ? null : { path: thread.path, start: thread.line, end: thread.line, lines: file };
      },
    };
  }

  private handlers(): TriageHandlers {
    return {
      onRunAi: () => {
        if (this.meta === null || this.settings === null) return;
        void runAi(this.meta, this.comments, this.settings, () => this.changed(), this.source()).then(() => this.changed());
        this.changed();
      },
      onOpenAiSettings: () => void this.services.openSettings?.(),
      onToggleTriage: () => { this.visit.collapsed = !this.visit.collapsed; this.changed(); },
      onToggleSuggestion: (key) => { this.visit.openKey = this.visit.openKey === key ? null : key; this.changed(); },
      onApplySuggestion: (key) => this.apply([key]),
      onApplyAll: (keys) => this.apply(keys),
      onDiscardSuggestion: (key) => void discardSuggestion(key).then(() => this.changed()),
      onDiscardAll: (keys) => void Promise.all(keys.map((key) => discardSuggestion(key))).then(() => this.changed()),
      onCopyPath: (path) => copyText(path),
      onHandOff: (id: string, how: HandOff, key: string) => this.handOff(id, how, key),
      onMissingTool: (tool) => this.services.reportMissingTool?.(tool),
    };
  }

  /** The finding and the others its fix answers, as one task for any coding agent: copied, or opened where its link carries it. */
  private handOff(id: string, how: HandOff, key: string): void {
    if (this.meta === null || this.settings === null || this.input === null) return;
    const url = providerReviewUrl(this.input.subject);
    const row = triageSuggestions(this.meta, this.settings).find((entry) => entry.entry.key === key);
    const findings = (row === undefined ? [] : [row.item, ...row.partners]).map((item) => {
      const note = triageNoteFor(item);
      const source = item.sources[0];
      return {
        title: item.title,
        ...(item.path === undefined ? {} : { path: item.path }),
        ...(item.line === undefined ? {} : { line: item.line }),
        ...(item.context === undefined ? {} : { context: item.context }),
        ...(note === null ? {} : { suggestion: note }),
        ...(source?.url === undefined ? {} : { url: source.url }),
      };
    });
    if (findings.length === 0) return;
    const task = agentTask(findings, url);
    const visit = this.key;
    const said = (text: string, copyAgain: boolean): void => {
      if (this.key !== visit) return;
      this.visit.handedOff = { text, copyAgain: copyAgain ? key : null };
      this.changed();
    };
    const target = how === 'open' ? openTargetById(id) : undefined;
    // Only targets whose link carries the task alone are offered here (`anyHost`), so the pull reference is unused.
    if (target !== undefined && target.anyHost === true) openTask(target, target.url(task, { owner: '', repo: '', number: 0 }), task, said);
    else copyTask(task, said);
  }
}
