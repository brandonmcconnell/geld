import type { GeldSettings } from '@geld/core';
import { repositoryKey, trustedReviewAccountFor } from '@geld/core';
import { botById, PROVIDER_BOT_CAPABILITIES, providerBotSupport } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { ProviderAiTriage } from './ai';
import type { ProviderAiDependencies } from './ai';
import { element } from './dom';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewPanel } from './review-panel';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';

const ACTION_NAMES = { approve: 'Approve', 'request-changes': 'Request changes', comment: 'Comment' };

export interface ProviderConversationServices {
  readonly saveTrustedBot?: (input: ProviderReviewInput, comment: ProviderReviewComment, botId: string) => Promise<void>;
  readonly aiDependencies?: Partial<ProviderAiDependencies>;
}

export function providerReviewWithTrustedAccounts(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], settings: GeldSettings, complete: boolean): ProviderReviewInput {
  const repository = { provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository };
  const authors = new Map([...input.threads.flatMap((thread) => thread.comments), ...comments].map((comment) => [comment.author.id, comment.author.login]));
  for (const reviewer of input.reviewers ?? []) authors.set(reviewer.author.id, reviewer.author.login);
  for (const check of input.checks ?? []) if (check.authorId !== undefined && !authors.has(check.authorId)) authors.set(check.authorId, check.authorId);
  const bots = [...authors].flatMap(([authorId, login]) => {
    const binding = trustedReviewAccountFor(settings.trustedReviewAccounts, repository, authorId);
    return binding === null || providerBotSupport(input.subject.provider, binding.botId)?.support !== 'supported' ? [] : [{ id: binding.botId, authorId, login }];
  });
  return { ...input, complete, bots };
}

export class ProviderConversation {
  private key = '';
  private generation = 0;
  private abort: AbortController | null = null;
  private snapshot: ProviderReviewSnapshot | null = null;
  private panel: ProviderReviewPanel | null = null;
  private actions: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private nextRefresh = 0;
  private error = '';
  private signature = '';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private observedHead: string | null = null;
  private snapshotVersion = 0;
  private readonly ai: ProviderAiTriage;

  constructor(private readonly adapter: ProviderAdapter, private readonly changed: () => void, private readonly services: ProviderConversationServices = {}) {
    this.ai = new ProviderAiTriage(() => this.changed(), services.aiDependencies);
  }

  apply(page: ProviderReviewPage | null, settings: GeldSettings): void {
    if (page === null || !settings.enabled || (!settings.prOverview && !settings.quickReview)) { this.clear(); return; }
    const key = JSON.stringify([repositoryKey(page.repository), page.url]);
    if (key !== this.key) { this.clear(); this.key = key; }
    if (page.headSha !== null && page.headSha !== this.observedHead) {
      this.observedHead = page.headSha;
      this.generation += 1;
      this.abort?.abort();
      this.abort = null;
      this.nextRefresh = 0;
      if (this.ai.state.key !== null) this.ai.reset();
      this.snapshot = null;
    }
    if (this.adapter.fetchReview === undefined) return;
    const host = page.kind === 'overview' && settings.prOverview ? this.adapter.reviewHost?.(document) ?? null : null;
    const actionHost = settings.quickReview ? this.adapter.actionHost?.(document) ?? null : null;
    if (host === null) { this.panel?.destroy(); this.panel = null; this.status?.remove(); this.status = null; }
    if (actionHost === null) { this.actions?.remove(); this.actions = null; this.signature = ''; }
    if (host === null && actionHost === null) return;
    if (this.abort === null && Date.now() >= this.nextRefresh) {
      const abort = new AbortController();
      this.abort = abort;
      const generation = this.generation;
      this.nextRefresh = Date.now() + 60_000;
      void this.adapter.fetchReview(page, abort.signal, document).then((snapshot) => {
        if (generation !== this.generation || abort.signal.aborted) return;
        this.snapshot = snapshot;
        this.snapshotVersion += 1;
        this.error = '';
      }).catch((error: unknown) => {
        if (generation !== this.generation || abort.signal.aborted) return;
        this.error = error instanceof Error ? error.message : 'Review unavailable';
        const retry = typeof error === 'object' && error !== null ? Reflect.get(error, 'retryAfterMs') : undefined;
        if (typeof retry === 'number' && Number.isFinite(retry) && retry > 0) this.nextRefresh = Date.now() + Math.min(Math.max(60_000, retry + 2000), 15 * 60_000);
      }).finally(() => {
        if (generation !== this.generation || abort.signal.aborted) return;
        this.abort = null;
        this.changed();
      });
    }
    const snapshot = this.snapshot;
    if (host !== null && snapshot !== null) {
      const input = providerReviewWithTrustedAccounts(snapshot.input, snapshot.comments, settings, snapshot.complete);
      if (settings.aiEnabled) void this.ai.load(input, snapshot.comments, settings);
      else if (this.ai.state.key !== null) this.ai.reset();
      const repository = { provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository };
      const saveTrustedBot = this.services.saveTrustedBot;
      this.status?.remove(); this.status = null;
      const options = {
        updating: this.abort !== null,
        version: this.snapshotVersion,
        ...(snapshot.sourceActions === undefined ? {} : { actionsForSource: snapshot.sourceActions }),
        ...(snapshot.renderComment === undefined ? {} : { renderComment: snapshot.renderComment }),
        onActionComplete: (): void => {
          this.nextRefresh = Date.now() + 700;
          if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            if (!document.hidden) this.changed();
          }, 700);
          this.changed();
        },
        comments: snapshot.comments, events: snapshot.events, complete: snapshot.complete,
        unavailable: this.error === '' ? snapshot.unavailable : [...snapshot.unavailable, { area: 'Refresh', reason: this.error }],
        approvalsRequired: snapshot.approvalsRequired, approvalsLeft: snapshot.approvalsLeft,
        transformItems: (items: Parameters<ProviderAiTriage['apply']>[0]) => this.ai.apply(items),
        ai: {
          enabled: settings.aiEnabled,
          state: this.ai.state,
          run: (): void => { void this.ai.run(input, snapshot.comments, settings); },
          cancel: (): void => this.ai.cancel(),
        },
        suggestedFixes: settings.suggestedFixes,
        ...(saveTrustedBot === undefined ? {} : { identifyReviewer: {
          repository,
          choices: PROVIDER_BOT_CAPABILITIES.filter((entry) => entry.provider === input.subject.provider && entry.support === 'supported').map((entry) => ({ id: entry.id, label: `${botById(entry.id)?.title ?? entry.id}${entry.formatVerified ? '' : ' (summary parsing unverified)'}` })),
          save: (comment: ProviderReviewComment, botId: string): Promise<void> => saveTrustedBot(input, comment, botId),
        } }),
        onOpenSource: (url: string, anchor: string, event: MouseEvent): void => {
          const target = document.getElementById(anchor);
          if (target === null || new URL(url).pathname !== window.location.pathname) return;
          event.preventDefault();
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          const originalTabIndex = target.getAttribute('tabindex');
          target.setAttribute('tabindex', '-1');
          target.addEventListener('blur', () => {
            if (target.getAttribute('tabindex') !== '-1') return;
            if (originalTabIndex === null) target.removeAttribute('tabindex');
            else target.setAttribute('tabindex', originalTabIndex);
          }, { once: true });
          target.focus({ preventScroll: true });
        },
      };
      if (this.panel === null || !this.panel.element.isConnected || this.panel.element.parentElement !== host) {
        this.panel?.destroy();
        this.panel = renderProviderReviewPanel(host, input, options);
      } else this.panel.update(input, options);
    } else if (host !== null) {
      if (this.status === null || !this.status.isConnected) {
        this.status = element('p', '', 'geld-provider-review__muted');
        this.status.setAttribute('role', 'status');
        host.append(this.status);
      }
      const message = this.error === '' ? 'Reading review…' : `Review unavailable: ${this.error}`;
      if (this.status.textContent !== message) this.status.textContent = message;
    }
    if (actionHost !== null && snapshot !== null) {
      const available = snapshot.actions.filter((action) => action.available);
      const signature = JSON.stringify([this.key, available.map((action) => action.kind)]);
      if (signature !== this.signature || this.actions?.isConnected !== true || this.actions.parentElement !== actionHost) {
        this.actions?.remove();
        this.signature = signature;
        if (available.length === 0) { this.actions = null; return; }
        this.actions = element('div', '', 'geld-provider-actions');
        this.actions.setAttribute('role', 'group');
        this.actions.setAttribute('aria-label', 'Review actions');
        for (const action of available) {
          const button = element('button', ACTION_NAMES[action.kind]);
          button.type = 'button';
          button.addEventListener('click', () => {
            button.disabled = true;
            void action.activate().then((opened) => { if (!opened) button.title = 'Open the provider review controls to continue'; })
              .catch(() => { button.title = 'The review controls are unavailable'; })
              .finally(() => { button.disabled = false; });
          });
          this.actions.append(button);
        }
        actionHost.append(this.actions);
      }
    }
  }

  clear(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.panel?.destroy(); this.panel = null;
    this.actions?.remove(); this.actions = null;
    this.status?.remove(); this.status = null;
    this.snapshot = null;
    this.key = '';
    this.nextRefresh = 0;
    this.error = '';
    this.signature = '';
    this.observedHead = null;
    this.snapshotVersion = 0;
    if (this.ai.state.key !== null || this.ai.state.kind !== 'idle') this.ai.reset();
  }
}
