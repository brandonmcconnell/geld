import type { GeldSettings } from '@geld/core';
import { repositoryKey, trustedReviewAccountFor } from '@geld/core';
import { botById, buildProviderReviewItems, isOpenStatus, PROVIDER_BOT_CAPABILITIES, providerBotSupport } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ReviewItem } from '@geld/review';
import { ProviderAiTriage } from './ai';
import type { ProviderAiDependencies } from './ai';
import { element } from './dom';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewPanel } from './review-panel';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';
import './conversation-compact.css';

const ACTION_NAMES = { approve: 'Approve', 'request-changes': 'Request changes', comment: 'Comment' };

function hiddenFlag(node: Element, name: string, hidden: boolean): void {
  if (hidden && !node.hasAttribute(name)) node.setAttribute(name, '');
  else if (!hidden && node.hasAttribute(name)) node.removeAttribute(name);
}

export interface ProviderConversationServices {
  readonly saveTrustedBot?: (input: ProviderReviewInput, comment: ProviderReviewComment, botId: string) => Promise<void>;
  readonly aiDependencies?: Partial<ProviderAiDependencies>;
  readonly readReviewed?: (input: ProviderReviewInput) => Promise<Readonly<Record<string, string>>>;
  readonly saveReviewed?: (input: ProviderReviewInput, item: ReviewItem, fingerprint: string, reviewed: boolean) => Promise<void>;
}

const reviewedNativeItems = new WeakMap<ProviderReviewInput, readonly ReviewItem[]>();

/** Fingerprints native sources, never AI wording or a local reviewed state. */
export async function reviewedItemFingerprint(input: ProviderReviewInput, item: ReviewItem, comments: readonly ProviderReviewComment[]): Promise<string> {
  let items = reviewedNativeItems.get(input);
  if (items === undefined) { items = buildProviderReviewItems(input); reviewedNativeItems.set(input, items); }
  const original = items.find((candidate) => candidate.id === item.id);
  const provenance = (candidate: ReviewItem): readonly unknown[] => candidate.sources.map((source) => [source.anchor, source.kind, source.sourceId, source.authorId, source.author, source.provider, source.origin, source.url]);
  if (original === undefined || JSON.stringify(provenance(original)) !== JSON.stringify(provenance(item))) throw new Error('The review item sources changed. Refresh the conversation before marking it reviewed.');
  const byAnchor = new Map([...comments, ...input.threads.flatMap((thread) => thread.comments)].map((comment) => [comment.anchor, comment]));
  const ordered = original.sources.map((source) => {
    const comment = byAnchor.get(source.anchor);
    if (comment === undefined) throw new Error('A review source is unavailable.');
    return comment;
  });
  const anchors = new Set(original.sources.map((source) => source.anchor));
  const threads = input.threads.filter((thread) => thread.comments.some((comment) => anchors.has(comment.anchor)));
  const nativeComment = (comment: ProviderReviewComment): readonly unknown[] => [comment.id, comment.anchor, comment.url, comment.author.id, comment.author.login, comment.author.automated, comment.body, comment.createdAt, comment.updatedAt];
  const payload = [[input.subject.provider, input.subject.origin, input.subject.repository, input.subject.id, input.subject.headSha], original.id, original.path, original.line, ordered.map(nativeComment), threads.map((thread) => [thread.id, thread.anchor, thread.url, thread.path, thread.line, thread.resolved, thread.outdated, thread.comments.map(nativeComment)])];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
  private readonly compacted = new Map<HTMLElement, { readonly key: string; readonly control: HTMLElement; readonly button: HTMLButtonElement }>();
  private readonly originalsShown = new Set<string>();
  private description: { readonly host: HTMLElement; readonly control: HTMLButtonElement; readonly hidden: Set<Element> } | null = null;
  private descriptionShown = false;
  private reviewedSignature = '';
  private reviewedGeneration = 0;
  private reviewedReady = false;
  private reviewed = new Set<string>();
  private reviewedPending = new Set<string>();
  private reviewedError = '';

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
      this.panel?.destroy(); this.panel = null;
      this.restoreCompact(); this.restoreDescription();
      this.resetReviewed();
    }
    if (this.adapter.fetchReview === undefined) return;
    const host = page.kind === 'overview' && settings.prOverview ? this.adapter.reviewHost?.(document) ?? null : null;
    const actionHost = settings.quickReview ? this.adapter.actionHost?.(document) ?? null : null;
    if (host === null) { this.panel?.destroy(); this.panel = null; this.status?.remove(); this.status = null; this.restoreCompact(); this.restoreDescription(); }
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
      this.loadReviewed(input, snapshot.comments);
      if (settings.aiEnabled) void this.ai.load(input, snapshot.comments, settings);
      else if (this.ai.state.key !== null) this.ai.reset();
      const repository = { provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository };
      const saveTrustedBot = this.services.saveTrustedBot;
      this.status?.remove(); this.status = null;
      const options = {
        updating: this.abort !== null,
        version: this.snapshotVersion,
        ...(snapshot.sourceActions === undefined ? {} : { actionsForSource: (comment: ProviderReviewComment) => snapshot.sourceActions?.(comment).map((action) => ({ ...action, activate: (): Promise<boolean> => { this.revealOriginal(comment.anchor); return action.activate(); } })) ?? [] }),
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
        reviewGrouping: settings.reviewGrouping,
        ...(!this.reviewedReady ? {} : { localReviewed: {
          ids: this.reviewed,
          pending: this.reviewedPending,
          ...(this.reviewedError === '' ? {} : { error: this.reviewedError }),
          set: (item: ReviewItem, reviewed: boolean): void => { void this.setReviewed(input, snapshot.comments, item, reviewed); },
        } }),
        ...(saveTrustedBot === undefined ? {} : { identifyReviewer: {
          repository,
          choices: PROVIDER_BOT_CAPABILITIES.filter((entry) => entry.provider === input.subject.provider && entry.support === 'supported').map((entry) => ({ id: entry.id, label: `${botById(entry.id)?.title ?? entry.id}${entry.formatVerified ? '' : ' (summary parsing unverified)'}` })),
          save: (comment: ProviderReviewComment, botId: string): Promise<void> => saveTrustedBot(input, comment, botId),
        } }),
        onOpenSource: (url: string, anchor: string, event: MouseEvent): void => {
          const target = document.getElementById(anchor);
          if (target === null || new URL(url).pathname !== window.location.pathname) return;
          this.revealOriginal(anchor);
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
      this.compact(input, snapshot, settings);
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

  private compact(input: ProviderReviewInput, snapshot: ProviderReviewSnapshot, settings: GeldSettings): void {
    const eligible = new Set<string>();
    if (settings.compactTimeline !== 'off') {
      for (const comment of [...input.threads.flatMap((thread) => thread.comments), ...snapshot.comments]) {
        if (comment.author.automated === true) eligible.add(comment.anchor);
      }
      if (settings.compactTimeline === 'minimal') for (const item of buildProviderReviewItems(input)) {
        if (!isOpenStatus(item.status) || this.reviewed.has(item.id)) for (const source of item.sources) eligible.add(source.anchor);
      }
      for (const event of snapshot.events) {
        if (event.kind !== 'activity' || event.lowSignal !== true) continue;
        try { const anchor = new URL(event.url).hash.slice(1); if (anchor !== '') eligible.add(anchor); } catch { /* An invalid source cannot hide native activity. */ }
      }
    }
    const roots = (this.adapter.conversationRoots?.(document) ?? []).filter((entry) => entry.anchors.length > 0 && entry.anchors.every((anchor) => eligible.has(anchor)) && !entry.root.contains(this.panel?.element ?? null) && entry.root.querySelector('textarea,[contenteditable="true"],[role="textbox"]') === null);
    const active = new Set(roots.map((entry) => entry.root));
    for (const [root, record] of this.compacted) {
      if (active.has(root) && record.control.isConnected) continue;
      root.removeAttribute('data-geld-provider-compact-hidden');
      record.control.remove();
      this.compacted.delete(root);
    }
    for (const entry of roots) {
      const key = [...entry.anchors].sort().join('|');
      const previous = this.compacted.get(entry.root);
      if (previous?.key === key) continue;
      if (previous !== undefined) { previous.control.remove(); this.compacted.delete(entry.root); }
      const button = element('button', '', 'geld-provider-toggle');
      button.type = 'button';
      const control = entry.root.tagName === 'LI' ? element('li') : entry.root.tagName === 'TR' ? element('tr') : element('div');
      control.className = 'geld-provider-original';
      if (control instanceof HTMLTableRowElement) {
        const cell = element('td');
        cell.colSpan = Math.max(1, [...entry.root.children].reduce((count, child) => count + (child instanceof HTMLTableCellElement ? child.colSpan : 1), 0));
        cell.append(button); control.append(cell);
      } else control.append(button);
      const update = (): void => {
        const shown = this.originalsShown.has(key);
        button.textContent = shown ? 'Hide original conversation entry' : 'Show original conversation entry';
        button.setAttribute('aria-expanded', String(shown));
        hiddenFlag(entry.root, 'data-geld-provider-compact-hidden', !shown);
      };
      button.addEventListener('click', () => { if (this.originalsShown.has(key)) this.originalsShown.delete(key); else this.originalsShown.add(key); update(); });
      entry.root.before(control);
      this.compacted.set(entry.root, { key, control, button });
      update();
    }
    const description = settings.compactTimeline === 'minimal' && settings.collapseDescription ? this.adapter.descriptionHost?.(document) ?? null : null;
    if (this.description?.host !== description) this.restoreDescription();
    if (description === null || description.contains(this.panel?.element ?? null)) return;
    const first = description.querySelector('p');
    if (first === null) { this.restoreDescription(); return; }
    const hidden = new Set<Element>();
    let current: Element = first;
    while (current !== description) {
      for (let sibling = current.nextElementSibling; sibling !== null; sibling = sibling.nextElementSibling) {
        if (sibling.closest('[data-geld-ui]') === null) hidden.add(sibling);
      }
      const parent = current.parentElement;
      if (parent === null) return;
      current = parent;
    }
    if (hidden.size === 0) { this.restoreDescription(); return; }
    if (this.description === null) {
      const control = element('button', '', 'geld-provider-toggle geld-provider-description-toggle');
      control.type = 'button';
      control.addEventListener('click', () => { this.descriptionShown = !this.descriptionShown; this.updateDescription(); });
      description.after(control);
      this.description = { host: description, control, hidden };
    } else {
      for (const node of this.description.hidden) if (!hidden.has(node)) node.removeAttribute('data-geld-provider-description-hidden');
      this.description = { ...this.description, hidden };
    }
    this.updateDescription();
  }

  private updateDescription(): void {
    if (this.description === null) return;
    for (const node of this.description.hidden) {
      hiddenFlag(node, 'data-geld-provider-description-hidden', !this.descriptionShown);
    }
    this.description.control.textContent = this.descriptionShown ? 'Collapse description' : 'Show full description';
    this.description.control.setAttribute('aria-expanded', String(this.descriptionShown));
  }

  private revealOriginal(anchor: string): void {
    const target = document.getElementById(anchor);
    for (const [root, record] of this.compacted) {
      if (target === null || !(root === target || root.contains(target))) continue;
      this.originalsShown.add(record.key);
      root.removeAttribute('data-geld-provider-compact-hidden');
      record.button.textContent = 'Hide original conversation entry';
      record.button.setAttribute('aria-expanded', 'true');
    }
  }

  private restoreCompact(): void {
    for (const [root, record] of this.compacted) { root.removeAttribute('data-geld-provider-compact-hidden'); record.control.remove(); }
    this.compacted.clear();
  }

  private restoreDescription(): void {
    if (this.description === null) return;
    for (const node of this.description.hidden) node.removeAttribute('data-geld-provider-description-hidden');
    this.description.control.remove();
    this.description = null;
  }

  private loadReviewed(input: ProviderReviewInput, comments: readonly ProviderReviewComment[]): void {
    const read = this.services.readReviewed;
    if (read === undefined || this.services.saveReviewed === undefined) return;
    const signature = JSON.stringify([input.subject, input.threads, input.bots]);
    if (signature === this.reviewedSignature) return;
    this.reviewedSignature = signature;
    const generation = ++this.reviewedGeneration;
    this.reviewedReady = false;
    this.reviewed = new Set();
    this.reviewedPending = new Set();
    this.reviewedError = '';
    void read(input).then(async (saved) => {
      if (generation !== this.reviewedGeneration) return;
      const items = buildProviderReviewItems(input).filter((item) => saved[item.id] !== undefined);
      const valid = await Promise.all(items.map(async (item) => [item.id, await reviewedItemFingerprint(input, item, comments) === saved[item.id]] satisfies readonly [string, boolean]));
      if (generation !== this.reviewedGeneration) return;
      this.reviewed = new Set(valid.filter(([, current]) => current).map(([id]) => id));
      this.reviewedReady = true;
      this.changed();
    }).catch((error: unknown) => {
      if (generation !== this.reviewedGeneration) return;
      this.reviewedReady = true;
      this.reviewedError = error instanceof Error ? error.message : 'Local review marks could not be loaded.';
      this.changed();
    });
  }

  private async setReviewed(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], item: ReviewItem, reviewed: boolean): Promise<void> {
    const save = this.services.saveReviewed;
    const signature = JSON.stringify([input.subject, input.threads, input.bots]);
    if (save === undefined || signature !== this.reviewedSignature || this.reviewedPending.has(item.id)) return;
    const generation = this.reviewedGeneration;
    const current = (): boolean => generation === this.reviewedGeneration && signature === this.reviewedSignature;
    this.reviewedPending = new Set([...this.reviewedPending, item.id]);
    this.reviewedError = '';
    this.changed();
    try {
      const fingerprint = await reviewedItemFingerprint(input, item, comments);
      if (!current()) return;
      await save(input, item, fingerprint, reviewed);
      if (!current()) return;
      const next = new Set(this.reviewed);
      if (reviewed) next.add(item.id); else next.delete(item.id);
      this.reviewed = next;
    } catch (error) {
      if (!current()) return;
      this.reviewedError = error instanceof Error ? error.message : 'The local review mark could not be saved.';
    } finally {
      if (current()) {
        this.reviewedPending = new Set([...this.reviewedPending].filter((id) => id !== item.id));
        this.changed();
      }
    }
  }

  private resetReviewed(): void {
    this.reviewedGeneration += 1;
    this.reviewedSignature = '';
    this.reviewedReady = false;
    this.reviewed = new Set();
    this.reviewedPending = new Set();
    this.reviewedError = '';
  }

  clear(): void {
    this.restoreCompact();
    this.restoreDescription();
    this.originalsShown.clear();
    this.descriptionShown = false;
    this.resetReviewed();
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
