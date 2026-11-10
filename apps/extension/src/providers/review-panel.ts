import { providerPreviews, providerPreviewDestination } from './previews';
import { renderProviderAgentNote } from './agent-notes';
import type { ProviderAgentNote } from './agent-notes';
import type { ProviderCommentRenderContext } from './comment-render';
import { botAppAvatar, botHealth, botById, buildProviderBotVerdicts, buildProviderReviewItems, CHECK_REPORTERS, fixVisible, isOpenStatus, latestPreviews, latestReports, newestProviderBotSummary, parseInlineMarkdown, providerBotSupport, providerReviewKey, providerReviewUrl, readCheckReport, renderProviderItemMarkdown, sourceLink, threadCounts } from '@geld/review';
import type { BotVerdictRecord, ProviderPublicationRead, ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, RawCheckRun, ReviewItem, ReviewItemStatus, ReviewerState } from '@geld/review';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderAiState } from './ai';
import { captureProviderSourceSelection } from './source-selection';
import { ProviderSummaryPreviews } from './summary-preview';
import type { ProviderSourceActionContext, ProviderSourceSelection } from './source-selection';

export type { ProviderSourceActionContext } from './source-selection';
import './review-dashboard.css';
import { digestIcon } from './digest-icons';
import type { DigestIcon } from './digest-icons';
import { shapeMark } from '../github/review/mark-shape';
import './bot-mark.css';

import { renderReviewerIdentity } from './reviewer-identity';
import { referenceForSubject } from './references';
import type { ProviderReviewReference } from './references';
import { renderPublisherIdentity } from './publisher-identity';
import { providerCheckKey, providerCheckPresentation, providerChecksCoverage } from './ci-checks';
import { providerCheckIcon } from './ci-icons';
import type { ReviewerIdentityChoice, ReviewerIdentityControl } from './reviewer-identity';
import { renderProviderBotRequest } from './bot-request';
import type { ProviderBotRequest, ProviderBotRequestControl } from './bot-request';

export interface ProviderReviewPanelEvent {
  readonly id: string;
  readonly url: string;
  readonly author: ProviderReviewAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly kind?: 'push' | 'commit' | 'state' | 'task' | 'activity';
  readonly headSha?: string;
  readonly lowSignal?: boolean;
}

export interface ProviderReviewAuthorPresentation {
  readonly authorId: string;
  readonly displayName: string;
  readonly profileUrl?: string;
  /** The alias actually shown by the native header, including any prefix. */
  readonly username?: string;
  readonly avatar?: {
    readonly src: string;
    readonly width: number;
    readonly height: number;
    readonly borderRadius?: string;
    readonly className?: string;
  };
  /** First-party author-header badges; never badges read from comment content. */
  readonly badges?: readonly {
    readonly label: string;
    readonly title?: string;
    readonly className?: string;
  }[];
}

export interface ProviderReviewRequirement {
  readonly id: string;
  readonly label: string;
  readonly state: 'passed' | 'failed' | 'pending' | 'unknown';
}

export interface ProviderReviewPanelOptions {
  readonly sourceInput?: ProviderReviewInput;
  readonly agentNotes?: readonly ProviderAgentNote[];
  readonly onRevealAgentNote?: (note: ProviderAgentNote) => void;
  readonly onOpenSettings?: () => Promise<void>;
  readonly onGrouping?: (grouping: 'type' | 'batch') => Promise<void>;
  readonly hasViewChoice?: boolean;
  readonly originalConversation?: { readonly shown: boolean; readonly toggle: () => void };

  readonly reviewerControls?: ProviderReviewSourceAction;
  readonly botRequests?: readonly ProviderBotRequest[];
  readonly updating?: boolean;
  readonly version?: number;
  readonly actionsForSource?: (comment: ProviderReviewComment) => readonly ProviderReviewSourceAction[];
  readonly renderEvent?: (event: ProviderReviewPanelEvent, host: HTMLElement) => boolean;
  readonly renderComment?: (comment: ProviderReviewComment, host: HTMLElement, context?: ProviderCommentRenderContext) => boolean;
  readonly commentSignature?: (comment: ProviderReviewComment) => string | null;
  readonly authorPresentation?: (comment: ProviderReviewComment) => ProviderReviewAuthorPresentation | null;
  readonly onActionComplete?: () => void;
  readonly comments?: readonly ProviderReviewComment[];
  readonly events?: readonly ProviderReviewPanelEvent[];
  readonly references?: readonly ProviderReviewReference[];
  readonly onRevealReference?: (reference: ProviderReviewReference) => boolean;
  readonly complete?: boolean;
  readonly unavailable?: readonly { readonly area: string; readonly reason: string }[];
  readonly approvalsRequired?: number | null;
  readonly approvalsLeft?: number | null;
  readonly requirements?: readonly ProviderReviewRequirement[] | null;
  readonly onOpenSource?: (url: string, anchor: string, event: MouseEvent) => void;
  readonly copyText?: (text: string) => void | Promise<void>;
  readonly transformItems?: (items: readonly ReviewItem[]) => readonly ReviewItem[];
  readonly suggestedFixes?: 'all' | 'bots' | 'ai' | 'off';
  readonly reviewGrouping?: 'type' | 'batch';
  readonly localReviewed?: {
    readonly ids: ReadonlySet<string>;
    readonly pending: ReadonlySet<string>;
    readonly error?: string;
    readonly set: (item: ReviewItem, reviewed: boolean) => void;
  };
  readonly ai?: {
    readonly enabled: boolean;
    readonly state: ProviderAiState;
    readonly run: () => void;
    readonly cancel: () => void;
  };
  readonly identifyReviewer?: {
    readonly repository: RepositoryIdentity;
    readonly choices: readonly ReviewerIdentityChoice[];
    readonly save: (comment: ProviderReviewComment, botId: string) => Promise<void>;
  };
  readonly publication?: {
    readonly result: ProviderPublicationRead;
    readonly repository: RepositoryIdentity;
    readonly save?: (comment: ProviderReviewComment) => Promise<void>;
  };
}

export interface ProviderReviewSourceAction {
  readonly kind: string;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
  activate(context?: ProviderSourceActionContext): Promise<boolean>;
}

export interface ProviderReviewPanel {
  readonly element: HTMLElement;
  update(input: ProviderReviewInput, options?: ProviderReviewPanelOptions): void;
  suspend(): void;
  destroy(): void;
}

const STANDING: Readonly<Record<ReviewerState, string>> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  pending: 'Review requested',
};

function reviewerRequested(reviewer: ProviderReviewReviewer): boolean {
  return reviewer.reviewRequest === 'pending' || (reviewer.reviewRequest === undefined && reviewer.state === 'pending');
}

function reviewerLabel(reviewer: ProviderReviewReviewer): string {
  if (reviewer.reviewRequest === undefined) return STANDING[reviewer.state];
  const standing = reviewer.state === 'pending' ? null : STANDING[reviewer.state];
  const request = reviewer.reviewRequest === 'pending' ? 'Review requested' : null;
  return [standing ?? (request === 'Review requested' ? null : 'Reviewer'), request].filter((label) => label !== null).join(' · ');
}

const STATUS: Readonly<Record<ReviewItemStatus, string>> = {
  open: 'Open',
  'needs-reply': 'Needs reply',
  addressed: 'Addressed',
  'done-manual': 'Reviewed on this device',
  resolved: 'Resolved',
  outdated: 'Outdated',
};

const GROUPS: readonly { readonly id: string; readonly label: string; readonly statuses: readonly ReviewItemStatus[]; readonly open: boolean }[] = [
  { id: 'open', label: 'Open items', statuses: ['open', 'needs-reply'], open: true },
  { id: 'addressed', label: 'Addressed items', statuses: ['addressed'], open: false },
  { id: 'outdated', label: 'Outdated items', statuses: ['outdated'], open: false },
  { id: 'resolved', label: 'Resolved items', statuses: ['resolved'], open: false },
  { id: 'done', label: 'Reviewed on this device', statuses: ['done-manual'], open: false },
];

const REQUIREMENT_STATE: Readonly<Record<ProviderReviewRequirement['state'], string>> = { passed: 'Passed', failed: 'Failed', pending: 'Pending', unknown: 'Unknown' };

function safeUrl(value: string, origin?: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') return null;
    return origin === undefined || url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function currentCheck(check: RawCheckRun, head: string): boolean {
  return check.sha === head || check.reviewHeadSha === head;
}

function authorPresentationKey(comment: ProviderReviewComment): string {
  return JSON.stringify([comment.id, comment.anchor, comment.author.id, comment.url]);
}

type ReviewDisclosure = HTMLElement & { open: boolean };

let nextPanelId = 0;

export function renderProviderReviewPanel(host: HTMLElement, initialInput: ProviderReviewInput, initialOptions: ProviderReviewPanelOptions = {}): ProviderReviewPanel {
  const doc = host.ownerDocument;
  const panelId = `geld-provider-review-${++nextPanelId}`;
  const expanded = new Map<string, boolean>();
  const touched = new Set<string>();
  const sourceDetails = new Map<string, boolean>();
  let input = initialInput;
  let options = initialOptions;
  let identity = '';
  let checksScope: string | null = null;
  let referenceScope: string | null = null;
  let destroyed = false;
  let items: readonly ReviewItem[] = [];
  let nativeItems: ReadonlyMap<string, ReviewItem> = new Map();
  const copyFocusTargets = new WeakMap<HTMLElement, { readonly subject: string; readonly route: string; readonly item: string; readonly kind: 'markdown' | 'fix'; readonly source: string }>();
  const authorPresentations = new Map<string, ProviderReviewAuthorPresentation>();
  let bots: readonly BotVerdictRecord[] = [];
  let identities: ReviewerIdentityControl[] = [];
  const botRequests = new Map<string, ProviderBotRequestControl>();
  const nativeTimes = new Map<number, string>();
  let lastSignature = '';
  let lastConversationSignature = '';
  let lastStatusSignatures: ReadonlyMap<string, string> = new Map();
  const nativeSourceNodes = new WeakMap<Element, number>();
  let nextNativeSourceNode = 0;
  let renderGeneration = 0;
  let renderScope = '';
  const renderStates = new Map<string, { readonly signature: string; readonly state: Map<string, boolean> }>();
  const activeRenderSources = new Set<string>();
  const sourceSlots = new Map<string, number>();
  const sourceOccurrences = new Map<string, number>();
  const activeSourceKeys = new Set<string>();
  let nextSourceSlot = 0;
  let commentFocusFrame: number | null = null;
  let mountCallbacks: Array<() => void> = [];
  let disposeCallbacks: Array<() => void> = [];
  let refreshCallbacks: Array<() => void> = [];
  let refreshListening = false;

  function refreshComments(): void {
    if (destroyed || !panel.isConnected) return;
    for (const callback of refreshCallbacks) callback();
  }

  function nativeSourceSignature(comment: ProviderReviewComment): readonly unknown[] | null {
    if (options.renderComment === undefined) return null;
    const root = doc.getElementById(comment.anchor);
    if (root === null || root.closest('[data-geld-ui]') !== null) return null;
    // Native table controls retain node bindings even when replacement markup looks identical.
    const nodes = [root, ...root.querySelectorAll('*')].map(element => {
      let id = nativeSourceNodes.get(element);
      if (id === undefined) { id = nextNativeSourceNode++;nativeSourceNodes.set(element, id); }
      return id;
    });
    // A provider body signature excludes typography carriers refreshed in place.
    return [nodes, options.commentSignature === undefined ? root.innerHTML : null];
  }

  function syncUpdating(): void {
    const previous = panel.querySelector('[data-geld-review-updating]');
    if (options.updating !== true) { previous?.remove();return; }
    if (previous !== null) return;
    const status = node('span', 'Updating…', 'geld-provider-review__muted');
    status.dataset.geldReviewUpdating = '';
    status.setAttribute('role', 'status');
    panel.querySelector('.geld-provider-review__brand')?.append(status);
  }

  function syncTimes(): void {
    for (const time of panel.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
      const native = nativeTimes.get(Date.parse(time.dateTime));
      if (native !== undefined && time.textContent !== native) time.textContent = native;
    }
  }

  function availableFocus(target: HTMLElement): boolean {
    if (target.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return false;
    for (let ancestor = target.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open && ancestor.querySelector(':scope > summary')?.contains(target) !== true) return false;
    }
    const preview = target.closest('[data-geld-review-preview]');
    const parent = target.hasAttribute('data-geld-review-toggle') ? target.parentElement?.parentElement : preview?.parentElement?.parentElement ?? target;
    return parent?.closest('[data-geld-review-open="false"]') == null;
  }

  function releaseHiddenFocus(): void {
    const focused = doc.activeElement;
    if (focused instanceof HTMLElement && panel.contains(focused) && !availableFocus(focused)) focused.blur();
  }

  function wrapSectionContent(child: HTMLElement): void {
    const sections = [child, ...child.querySelectorAll<HTMLElement>('[data-geld-review-key]')].filter(section => section.hasAttribute('data-geld-review-key'));
    for (const section of sections) {
      if (section.querySelector(':scope > .geld-provider-review__section-content') !== null) continue;
      const content = node('div', '', 'geld-provider-review__section-content');
      content.id = `${section.id}-content`;
      content.setAttribute('role', 'region');
      content.setAttribute('aria-labelledby', `${section.id}-toggle`);
      for (const entry of [...section.childNodes]) {
        if (entry instanceof Element && (entry.hasAttribute('data-geld-review-toggle') || entry.hasAttribute('data-geld-review-preview'))) continue;
        content.append(entry);
      }
      section.append(content);
    }
  }

  function readingAnchor(): (() => void) | null {
    const anchor = [...panel.querySelectorAll<HTMLElement>('.geld-provider-review__source, [data-geld-item]')].find(element => {
      const box = element.getBoundingClientRect();
      return box.height > 0 && box.bottom > 0 && box.top < (doc.defaultView?.innerHeight ?? 0);
    });
    if (anchor === undefined) return null;
    const top = anchor.getBoundingClientRect().top;
    let scroll = anchor.parentElement;
    while (scroll !== null && !(scroll.scrollHeight > scroll.clientHeight && /^(?:auto|scroll)$/.test(doc.defaultView?.getComputedStyle(scroll).overflowY ?? ''))) scroll = scroll.parentElement;
    const scroller = scroll ?? doc.scrollingElement;
    if (scroller == null) return null;
    return () => { if (anchor.isConnected) scroller.scrollTop += anchor.getBoundingClientRect().top - top; };
  }

  let statusOnly = false;

  function syncStatusRows(changed: ReadonlySet<string>): void {
    const restoreAnchor = readingAnchor();
    statusOnly = true;
    const rows: readonly [string, () => HTMLElement | null][] = [['reviewers', reviewStandings], ['bots', botsSection], ['requirements', requirementsSection], ['reports', reportsSection], ['checks', checksSection]];
    for (const [key, renderRow] of rows) {
      if (!changed.has(key)) continue;
      const next = renderRow();
      const previous = panel.querySelector<HTMLElement>(`:scope > [data-geld-review-key="${key}"]`);
      if (next === null) { previous?.remove();continue; }
      wrapSectionContent(next);
      if (previous?.outerHTML === next.outerHTML) continue;
      if (previous !== null) previous.replaceWith(next);
      else if (key === 'bots') panel.querySelector(':scope > [data-geld-review-key="reviewers"]')?.after(next);
      else if (key === 'requirements') panel.querySelector(':scope > [data-geld-review-key="reviewers"]')?.after(next);
      else if (key === 'reports') panel.querySelector(':scope > [data-geld-review-key="checks"]')?.before(next);
    }
    statusOnly = false;
    syncUpdating();syncTimes();refreshComments();restoreAnchor?.();
  }

  function onCommentRefresh(callback: () => void): void {
    refreshCallbacks.push(callback);
    if (refreshListening) return;
    refreshListening = true;
    doc.defaultView?.addEventListener('resize', refreshComments);
    doc.defaultView?.visualViewport?.addEventListener('resize', refreshComments);
  }

  function clearRenderStates(): void {
    for (const memo of renderStates.values()) memo.state.clear();
    renderStates.clear();
  }

  function disposeComments(): void {
    summaryPreviews.clear();
    renderGeneration += 1;
    if (commentFocusFrame !== null) doc.defaultView?.cancelAnimationFrame(commentFocusFrame);
    commentFocusFrame = null;
    for (const callback of disposeCallbacks.splice(0)) callback();
    mountCallbacks = [];
    refreshCallbacks = [];
    if (refreshListening) {
      doc.defaultView?.removeEventListener('resize', refreshComments);
      doc.defaultView?.visualViewport?.removeEventListener('resize', refreshComments);
      refreshListening = false;
    }
    sourceOccurrences.clear();activeRenderSources.clear();activeSourceKeys.clear();
  }

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag);
    value.dataset.geldUi = '';
    if (text !== '') value.textContent = text;
    if (className !== '') value.className = className;
    return value;
  }

  const panel = node('section', '', 'geld-provider-review');
  const summaryPreviews = new ProviderSummaryPreviews(panel);
  panel.setAttribute('aria-label', 'Geld review digest');
  host.prepend(panel);
  const dismissMenus = (event: Event): void => {
    for (const menu of panel.querySelectorAll<HTMLDetailsElement>('details.geld-provider-review__menu[open]')) {
      if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
  };
  doc.addEventListener('pointerdown', dismissMenus);

  function disclosure(key: string, label: string, initiallyOpen: boolean): ReviewDisclosure {
    const section = Object.assign(node('section', '', 'geld-provider-review__section'), { open: false });
    section.dataset.geldReviewKey = key;
    const toggle = node('button', '', 'geld-provider-review__section-toggle');
    toggle.type = 'button';
    toggle.dataset.geldReviewToggle = '';
    const id = `${panelId}-section-${encodeURIComponent(key)}`;
    section.id = id;
    toggle.id = `${id}-toggle`;
    toggle.setAttribute('aria-controls', `${id}-content`);
    toggle.append(node('span', label, 'geld-provider-review__section-label'));
    const icons: Readonly<Record<string, DigestIcon>> = { reviewers: 'reviews', checks: 'check', bots: 'check', requirements: 'check', reports: 'report', 'agent-notes': 'report', previews: 'preview', comments: 'comment', activity: 'activity' };
    const glyph = icons[key] ?? (key.startsWith('references:') ? 'link' : undefined);
    if (glyph !== undefined) {
      section.dataset.geldStatusRow = '';
      toggle.prepend(digestIcon(glyph, doc));
    }
    const setOpen = (open: boolean, chosen = false): void => {
      if (chosen) touched.add(key);
      section.dataset.geldReviewOpen = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      expanded.set(key, open);
    };
    Object.defineProperty(section, 'open', {
      get: () => section.dataset.geldReviewOpen === 'true',
      set: (open: boolean) => setOpen(open, true),
    });
    toggle.addEventListener('click', () => { section.open = !section.open; });
    section.append(toggle);
    setOpen(expanded.get(key) ?? initiallyOpen);
    return section;
  }

  function link(label: string, url: string, anchor = '', external = false): HTMLAnchorElement {
    const value = node('a', label);
    value.href = url;
    if (external) {
      value.target = '_blank';
      value.rel = 'noopener noreferrer';
    } else if (options.onOpenSource !== undefined) {
      value.addEventListener('click', (event) => options.onOpenSource?.(url, anchor, event));
    }
    return value;
  }

  function inline(hostNode: HTMLElement, text: string): void {
    for (const run of parseInlineMarkdown(text)) {
      let parent = hostNode;
      for (const mark of run.marks) {
        const child = node(mark);
        parent.append(child);
        parent = child;
      }
      parent.append(doc.createTextNode(run.text));
    }
  }

  function timestamp(value: string): HTMLTimeElement | null {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [['year', 365 * 86400], ['month', 30 * 86400], ['week', 7 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    const [, size] = units.find(([, candidate]) => Math.abs(seconds) >= candidate) ?? ['second', 1];
    const unit = units.find(([, candidate]) => candidate === size)?.[0] ?? 'second';
    const fallback = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-Math.trunc(seconds / size), unit);
    const time = node('time', nativeTimes.get(date.getTime()) ?? fallback);
    time.dateTime = date.toISOString();
    time.title = date.toISOString();
    return time;
  }

  function copyControl(label: string, itemId: string, kind: 'markdown' | 'fix', text: () => string): HTMLElement {
    const wrapper = node('span');
    const button = node('button', label, 'geld-provider-review__copy');
    button.type = 'button';button.setAttribute('aria-label', label);
    button.dataset.geldItemCopy = itemId;button.dataset.geldCopyKind = kind;
    const message = node('span', '', 'geld-provider-review__muted');
    message.setAttribute('role', 'status');message.setAttribute('aria-live', 'polite');
    const subject = JSON.stringify(input.subject);
    const route = new URL(doc.URL);route.hash = '';
    const nativeItem = nativeItems.get(itemId);
    if (nativeItem !== undefined) copyFocusTargets.set(button, { subject, route: route.href, item: itemId, kind, source: JSON.stringify(nativeItem) });
    const current = (): boolean => {
      const active = new URL(doc.URL);active.hash = '';
      return !destroyed && button.isConnected && subject === JSON.stringify(input.subject) && route.href === active.href;
    };
    button.addEventListener('click', () => {
      if (!current() || button.disabled) return;
      button.disabled = true;button.setAttribute('aria-busy', 'true');message.textContent = '';
      const write = options.copyText ?? ((value: string): Promise<void> => navigator.clipboard.writeText(value));
      void Promise.resolve().then(async () => {
        if (!current()) return;
        await write(text());
        if (current()) { button.textContent = 'Copied';message.textContent = kind === 'fix' ? 'Suggested fix copied.' : 'Item copied as Markdown.'; }
      }).catch(() => {
        if (current()) { button.textContent = label;message.textContent = 'Could not copy. Try again.'; }
      }).finally(() => {
        if (current()) { button.disabled = false;button.removeAttribute('aria-busy'); }
      });
    });
    wrapper.append(button, message);
    return wrapper;
  }

  function sourceComment(comment: ProviderReviewComment): HTMLElement {
    const article = node('article', '', 'geld-provider-review__source');
    article.dataset.geldSource = comment.anchor;
    article.dataset.geldSourceId = comment.id;
    article.dataset.geldSourceUrl = comment.url;
    const byline = node('div', '', 'geld-provider-review__byline');
    const presentation = authorPresentations.get(authorPresentationKey(comment));
    const name = node('strong', presentation?.displayName ?? comment.author.login);
    name.dataset.geldAuthorName = '';
    if (presentation === undefined) byline.append(name);
    else {
      const nativeClasses = (className: string | undefined): string => (className ?? '').split(/\s+/).filter((token) => /^[a-zA-Z0-9_!@:/.-]+$/.test(token) && !token.startsWith('geld-')).join(' ');
      const avatar = presentation.avatar;
      const avatarUrl = avatar === undefined ? null : safeUrl(avatar.src);
      if (avatar !== undefined && avatarUrl !== null && new URL(avatarUrl).protocol === 'https:' && Number.isFinite(avatar.width) && Number.isFinite(avatar.height) && avatar.width > 0 && avatar.height > 0 && avatar.width <= 128 && avatar.height <= 128) {
        const image = node('img');
        image.dataset.geldAuthorAvatar = '';
        image.src = avatarUrl;
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        image.referrerPolicy = 'no-referrer';
        image.decoding = 'async';
        image.loading = 'lazy';
        image.className = nativeClasses(avatar.className);
        image.style.width = `${avatar.width}px`;
        image.style.height = `${avatar.height}px`;
        if (avatar.borderRadius !== undefined) image.style.borderRadius = avatar.borderRadius;
        const slot = node('span', '', 'geld-provider-review__avatar-slot');
        slot.dataset.geldAuthorAvatarSlot = '';
        slot.style.width = slot.style.inlineSize = `${avatar.width}px`;
        slot.style.height = slot.style.blockSize = `${avatar.height}px`;
        slot.append(image);
        byline.append(slot);
      }
      const profileUrl = presentation.profileUrl === undefined ? null : safeUrl(presentation.profileUrl, input.subject.origin);
      if (profileUrl === null) byline.append(name);
      else {
        const profile = node('a');
        profile.dataset.geldAuthorProfile = '';
        profile.href = profileUrl;
        profile.append(name);
        byline.append(profile);
      }
      if (presentation.username !== undefined && presentation.username.trim() !== '') byline.append(node('span', presentation.username, 'geld-provider-review__muted'));
      for (const badge of presentation.badges ?? []) {
        if (badge.label.trim() === '') continue;
        const mark = node('span', badge.label, nativeClasses(badge.className));
        mark.dataset.geldAuthorBadge = '';
        if (badge.title !== undefined) mark.title = badge.title;
        byline.append(mark);
      }
    }
    if (comment.author.automated === true) byline.append(node('span', 'Automated account', 'geld-provider-review__muted'));
    const time = timestamp(comment.createdAt);
    if (time !== null) byline.append(time);
    if (comment.updatedAt !== undefined && comment.updatedAt !== comment.createdAt) {
      const edited = timestamp(comment.updatedAt);
      if (edited !== null) {
        edited.prepend(doc.createTextNode('Edited '));
        byline.append(edited);
      }
    }
    const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
    if (url !== null) byline.append(link('View original', url, comment.anchor));
    const body = node('div', comment.body, 'geld-provider-review__body');
    body.style.whiteSpace = 'pre-wrap';
    body.style.overflowWrap = 'anywhere';
    const sourceKey = JSON.stringify([comment.anchor, comment.id]);
    if (!sourceSlots.has(sourceKey)) sourceSlots.set(sourceKey, nextSourceSlot++);
    activeSourceKeys.add(sourceKey);
    const occurrence = sourceOccurrences.get(sourceKey) ?? 0;
    sourceOccurrences.set(sourceKey, occurrence + 1);
    const namespace = `${panelId}-source-${sourceSlots.get(sourceKey)}-${occurrence}`;
    const sourceSignature = JSON.stringify(comment);
    let memo = renderStates.get(namespace);
    if (memo?.signature !== sourceSignature) { memo?.state.clear();memo = { signature: sourceSignature, state: new Map() };renderStates.set(namespace, memo); }
    activeRenderSources.add(namespace);
    const generation = renderGeneration;
    const context: ProviderCommentRenderContext = {
      idNamespace: namespace,
      state: memo.state,
      current: () => !destroyed && generation === renderGeneration && body.isConnected && panel.contains(body),
      onMount: (callback) => mountCallbacks.push(callback),
      onDispose: (callback) => disposeCallbacks.push(callback),
      onRefresh: onCommentRefresh,
    };
    if (options.renderComment?.(comment, body, context) === true) {
      body.style.whiteSpace = 'normal';
      [...body.querySelectorAll<HTMLDetailsElement>('details')].forEach((details, index) => {
        const key = `${comment.anchor}:${index}`;
        details.dataset.geldBodyDisclosure = key;
        const open = sourceDetails.get(key);
        if (open !== undefined) details.open = open;
        details.addEventListener('toggle', () => sourceDetails.set(key, details.open));
      });
    }
    article.append(byline, body);
    const identify = options.identifyReviewer;
    if (identify !== undefined && comment.author.automated === true && !(input.bots ?? []).some((bot) => bot.authorId === comment.author.id)) {
      const choices = identify.choices.filter((choice) => providerBotSupport(input.subject.provider, choice.id)?.support === 'supported');
      identities.push(renderReviewerIdentity(article, comment, identify.repository, choices, (botId) => identify.save(comment, botId)));
    }
    const actions = options.actionsForSource?.(comment).filter((action) => action.available) ?? [];
    if (actions.length > 0) {
      const controls = node('div', '', 'geld-provider-review__source-actions');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', `Actions for ${comment.author.login}'s comment`);
      for (const action of actions) {
        const button = node('button', action.label);
        button.type = 'button';
        let pointerSelection: ProviderSourceSelection | undefined;
        if (action.kind === 'quote') {
          button.addEventListener('pointerdown', () => { pointerSelection = captureProviderSourceSelection(comment, body); });
          for (const event of ['pointercancel', 'pointerleave', 'keydown', 'blur']) button.addEventListener(event, () => { pointerSelection = undefined; });
        }
        button.addEventListener('click', () => {
          const captured = action.kind === 'quote' ? captureProviderSourceSelection(comment, body) : undefined;
          const selection = captured ?? pointerSelection;
          pointerSelection = undefined;
          const current = (): boolean => !destroyed && !panel.inert && body.isConnected && article.isConnected && article.dataset.geldSource === comment.anchor;
          if (!current()) return;
          const matches = options.actionsForSource?.(comment).filter(candidate => candidate.available && candidate.kind === action.kind) ?? [];
          const latest = matches.length === 1 ? matches[0] : undefined;
          if (latest === undefined) return;
          button.disabled = true;
          void latest.activate({ ...(selection === undefined ? {} : { selection }), current }).then((activated) => {
            if (!current()) return;
            if (activated) options.onActionComplete?.();
            else button.title = action.kind === 'quote' && selection !== undefined ? 'Select the passage again in the original comment.' : 'The original comment controls are unavailable';
          }).catch(() => { button.title = 'The original comment controls are unavailable'; })
            .finally(() => { button.disabled = false; });
        });
        controls.append(button);
      }
      article.append(controls);
    }
    return article;
  }

  function reviewStandingSummary(): { readonly coverage: 'complete' | 'partial' | 'unavailable'; readonly label: string } {
    const reviewers = input.reviewers?.filter(reviewer => !automatedAuthor(reviewer.author));
    const approvals = reviewers?.filter((reviewer) => reviewer.state === 'approved').length ?? 0;
    const changes = reviewers?.filter((reviewer) => reviewer.state === 'changes_requested').length ?? 0;
    const pending = reviewers?.filter(reviewerRequested).length ?? 0;
    const required = options.approvalsRequired;
    const left = options.approvalsLeft;
    const requiredTally = typeof required === 'number' && typeof left === 'number' && Number.isSafeInteger(required) && Number.isSafeInteger(left) && required > 0 && left >= 0 && left <= required
      ? `${required - left}/${required} required approvals`
      : null;
    const coverage = reviewers === undefined ? requiredTally === null ? 'unavailable' : 'partial'
      : options.unavailable?.some((source) => source.area === 'reviews') === true ? 'partial' : 'complete';
    if (coverage === 'unavailable') return { coverage, label: 'Reviews · Unavailable' };
    const observed = coverage === 'partial' ? 'observed ' : '';
    const tallies = [
      requiredTally ?? (coverage === 'complete' || approvals > 0 ? countLabel(approvals, `${observed}approval`) : null),
      changes === 0 ? null : countLabel(changes, `${observed}change request`),
      pending === 0 ? null : countLabel(pending, `${observed}pending review`),
    ].filter((value) => value !== null);
    return { coverage, label: ['Reviews', ...(coverage === 'partial' ? ['Partial'] : []), ...tallies].join(' · ') };
  }

  function conversationComments(): readonly ProviderReviewComment[] { return [...input.threads.flatMap(thread => thread.comments), ...(options.comments ?? [])]; }

  function automatedAuthor(author: ProviderReviewAuthor): boolean {
    return author.automated === true || conversationComments().some(comment => comment.author.id === author.id && comment.author.login === author.login && comment.author.automated === true)
      || (input.bots ?? []).some(bot => bot.authorId === author.id);
  }

  function itemAuthor(item: ReviewItem): ProviderReviewAuthor | undefined {
    const source = item.sources[0];
    return source === undefined ? undefined : conversationComments().find(comment => comment.anchor === source.anchor)?.author;
  }

  function threadGroups(selected: readonly ReviewItem[], key: string): readonly HTMLElement[] {
    const comments = new Map(input.threads.flatMap(thread => thread.comments.map(comment => [comment.anchor, comment] as const)));
    return GROUPS.flatMap(group => {
      const members = selected.filter(item => group.statuses.includes(item.status));
      if (members.length === 0) return [];
      const groupKey = `${key}:group:${group.id}`;
      if (!touched.has(groupKey) && members.some(item => expanded.get(itemDisclosureKey(item)) === true)) expanded.set(groupKey, true);
      const section = disclosure(groupKey, `${group.label.replace('items', 'threads')} · ${threadCounts(members).total}`, group.open);
      section.dataset.geldReviewGroup = group.id;
      for (const item of members) section.append(itemSection(item, comments));
      return [section];
    });
  }

  function authorAvatar(author: ProviderReviewAuthor): HTMLElement {
    const presentation = [...authorPresentations.values()].find(value => value.authorId === author.id);
    const mark = node('span', '', 'geld-provider-review__reviewer-avatar');mark.setAttribute('aria-hidden', 'true');
    const url = presentation?.avatar === undefined ? null : safeUrl(presentation.avatar.src);
    if (url !== null && new URL(url).protocol === 'https:') {
      const image = node('img');image.src = url;image.alt = '';image.referrerPolicy = 'no-referrer';mark.append(image);
    } else mark.textContent = author.login.charAt(0).toUpperCase();
    return mark;
  }

  function commentRow(comment: ProviderReviewComment): HTMLElement {
    const source = sourceComment(comment);
    const row = disclosure(`comment:${comment.id}`, '', false);
    row.dataset.geldCommentRow = comment.id;
    row.classList.add('geld-provider-review__entry');
    const summary = row.querySelector('[data-geld-review-toggle]');
    const body = source.querySelector('.geld-provider-review__body');
    const preview = (body?.querySelector('p, h1, h2, h3')?.textContent ?? body?.textContent ?? comment.body).replace(/\s+/g, ' ').trim();
    summary?.replaceChildren(digestIcon('comment', doc), authorAvatar(comment.author), node('strong', comment.author.login), node('span', preview.slice(0, 160), 'geld-provider-review__entry-preview'));
    const time = timestamp(comment.createdAt);if (time !== null) summary?.append(time);
    row.append(source);return row;
  }

  function commentRounds(comments: readonly ProviderReviewComment[], key: string): readonly HTMLElement[] {
    const pushes = activityEvents().filter(event => event.kind === 'push' && Number.isFinite(Date.parse(event.createdAt))).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (pushes.length === 0) return comments.map(commentRow);
    const groups = new Map<number, ProviderReviewComment[]>();
    for (const comment of comments) {
      const index = pushes.findLastIndex(push => Date.parse(push.createdAt) <= Date.parse(comment.createdAt));
      const group = groups.get(index) ?? [];group.push(comment);groups.set(index, group);
    }
    return [...groups].sort(([a], [b]) => b - a).map(([index, entries]) => {
      const push = pushes[index];
      const round = disclosure(`${key}:round:${push?.id ?? 'before'}`, index < 0 ? 'Before the first recorded push' : `Push round ${index + 1}`, true);
      for (const comment of entries) round.append(commentRow(comment));
      return round;
    });
  }

  function authorConversation(author: ProviderReviewAuthor): HTMLElement {
    const key = `author:${author.id}`;
    if (statusOnly) {
      const existing = [...panel.querySelectorAll<HTMLElement>('[data-geld-author-conversation]')].find(node => node.dataset.geldAuthorConversation === key);
      if (existing !== undefined) return existing;
    }
    const content = node('div');content.dataset.geldAuthorConversation = key;
    if (options.reviewGrouping === 'batch') return content;
    content.append(...threadGroups(items.filter(item => itemAuthor(item)?.id === author.id), key));
    const ids = new Set(input.threads.flatMap(thread => thread.comments.map(comment => comment.id)));
    content.append(...commentRounds((options.comments ?? []).filter(comment => comment.author.id === author.id && !ids.has(comment.id)), key));
    return content;
  }

  function reviewStandings(): HTMLElement {
    const reviewers = (input.reviewers ?? []).filter(reviewer => !automatedAuthor(reviewer.author));
    for (const item of items) {
      const author = itemAuthor(item);
      if (author !== undefined && !automatedAuthor(author) && !reviewers.some(reviewer => reviewer.author.id === author.id)) reviewers.push({ author, state: 'commented' });
    }
    const summary = reviewStandingSummary();
    const section = disclosure('reviewers', 'Reviews', false);
    const summaryElement = section.querySelector('[data-geld-review-toggle]');
    summaryElement?.setAttribute('aria-label', summary.label);
    section.append(node('p', summary.label, 'geld-provider-review__reviewer-summary'));
    const preview = node('span', '', 'geld-provider-review__row-preview');
    preview.setAttribute('aria-label', summary.label);
    if (summary.coverage !== 'complete' || (reviewers?.length ?? 0) === 0) preview.append(node('span', summary.label.replace(/^Reviews(?: · )?/, ''), 'geld-provider-review__muted'));
    summaryElement?.append(preview);
    if (options.reviewerControls?.available === true) {
      const controls = node('div', '', 'geld-provider-review__source-actions');
      const button = node('button', 'Reviewer controls');
      button.type = 'button';
      button.dataset.geldReviewerControls = '';
      button.title = 'Focus GitLab’s native reviewer controls.';
      const subject = providerReviewKey(input.subject);
      const head = input.subject.headSha;
      const current = (): boolean => !destroyed && button.isConnected && panel.contains(button) && providerReviewKey(input.subject) === subject
        && input.subject.headSha === head && options.reviewerControls?.available === true;
      button.addEventListener('click', () => {
        const action = options.reviewerControls;
        if (!current() || action === undefined) return;
        button.disabled = true;
        void Promise.resolve().then(() => current() ? action.activate({ current }) : false).then((focused) => {
          if (current() && !focused) button.title = 'The native reviewer controls are unavailable.';
        }).catch(() => { if (current()) button.title = 'The native reviewer controls are unavailable.'; })
          .finally(() => { if (current()) button.disabled = false; });
      });
      controls.append(button);
      section.append(controls);
    }
    if (summary.coverage !== 'complete') section.append(node('p', summary.coverage === 'unavailable' ? 'Review standings could not be read.' : 'Some review standings could not be read.'));
    if (reviewers === undefined || reviewers.length === 0) {
      if (summary.coverage === 'complete') section.append(node('p', 'No reviewer standings.'));
      return section;
    }
    const list = node('div', '', 'geld-provider-review__reviewers');
    list.setAttribute('role', 'list');
    for (const reviewer of reviewers) {
      const row = disclosure(`reviewer:${reviewer.author.id}`, '', false);
      row.classList.add('geld-provider-review__standing', 'geld-provider-review__entry');
      row.setAttribute('role', 'listitem');row.dataset.geldReviewer = reviewer.author.id;
      row.dataset.state = reviewer.state;
      if (reviewer.reviewRequest !== undefined) row.dataset.reviewRequest = reviewer.reviewRequest;
      const source = reviewer.state !== 'pending' && reviewer.url !== undefined && reviewer.anchor !== undefined
        ? sourceLink({ anchor: reviewer.anchor, kind: 'comment', author: reviewer.author.login, url: reviewer.url }, input.subject) : null;
      const chip = source === null ? node('span') : link('', source, reviewer.anchor);
      chip.classList.add('geld-provider-review__reviewer');
      chip.setAttribute('aria-label', `${reviewer.author.login}: ${reviewerLabel(reviewer)}`);
      if (source !== null) {
        chip.title = 'Open the latest review update';
        const subject = providerReviewKey(input.subject), head = input.subject.headSha;
        chip.addEventListener('click', event => {
          if (destroyed || !chip.isConnected || !panel.contains(chip) || subject !== providerReviewKey(input.subject) || head !== input.subject.headSha) { event.preventDefault();event.stopImmediatePropagation(); }
        }, { capture: true });
        chip.addEventListener('click', event => event.stopPropagation());
      }
      const presentation = [...authorPresentations.values()].find(value => value.authorId === reviewer.author.id && value.avatar !== undefined);
      const avatar = presentation?.avatar;
      const avatarUrl = avatar === undefined ? null : safeUrl(avatar.src);
      const mark = node('span', '', 'geld-provider-review__reviewer-avatar');mark.setAttribute('aria-hidden', 'true');
      if (avatarUrl !== null && new URL(avatarUrl).protocol === 'https:') {
        const image = node('img');image.src = avatarUrl;image.alt = '';image.referrerPolicy = 'no-referrer';image.decoding = 'async';mark.append(image);
      } else mark.textContent = reviewer.author.login.charAt(0).toUpperCase() || '?';
      chip.append(mark, node('span', reviewer.author.login, 'geld-provider-review__reviewer-name'));
      if (reviewer.state !== 'pending' || !reviewerRequested(reviewer)) chip.append(node('span', reviewer.state === 'pending' ? 'Reviewer' : STANDING[reviewer.state], 'geld-provider-review__reviewer-verdict'));
      if (reviewerRequested(reviewer)) {
        const request = node('span', 'Review requested', 'geld-provider-review__reviewer-request');
        request.title = reviewer.state === 'pending' ? 'Review requested' : 'Review requested again. The current verdict still stands.';
        chip.append(request);
      }
      const compact = node('span', '', 'geld-provider-review__status-chip');
      compact.dataset.state = reviewer.state;
      compact.title = `${reviewer.author.login}: ${reviewerLabel(reviewer)}`;
      compact.append(mark.cloneNode(true), node('span', presentation?.displayName ?? reviewer.author.login));
      if (reviewer.state === 'approved') compact.append(digestIcon('check', doc));
      else compact.append(node('span', reviewerLabel(reviewer), 'geld-provider-review__muted'));
      preview.append(compact);
      if (reviewer.author.automated === true) chip.append(node('span', 'Automated account', 'geld-provider-review__muted'));
      const comments = new Map<string, ProviderReviewComment>();
      for (const comment of [...input.threads.flatMap(thread => thread.comments), ...(options.comments ?? [])]) {
        if (comment.author.id === reviewer.author.id && comment.body.trim() !== '' && sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject) !== null) comments.set(comment.id, comment);
      }
      const threads = input.threads.filter(thread => thread.comments[0]?.author.id === reviewer.author.id && comments.has(thread.comments[0].id)).length;
      if (comments.size > 0) {
        const observed = input.complete !== true || options.complete === false ? 'observed ' : '';
        const counts = [threads > 0 ? `${threads} ${observed}thread${threads === 1 ? '' : 's'} started` : null, countLabel(comments.size, `${observed}comment`)].filter(value => value !== null);
        const activity = node('span', `In this conversation: ${counts.join(' · ')}`, 'geld-provider-review__reviewer-activity');
        activity.title = 'Conversation activity by this account. These counts are not grouped into a review.';
        row.append(activity);
      }
      const toggle = row.querySelector('[data-geld-review-toggle]');
      toggle?.replaceChildren(digestIcon(reviewer.state === 'approved' ? 'check' : 'reviews', doc), mark.cloneNode(true), node('strong', presentation?.displayName ?? reviewer.author.login), node('span', reviewerLabel(reviewer), 'geld-provider-review__entry-preview'));
      row.prepend(chip);row.append(authorConversation(reviewer.author));list.append(row);
    }
    section.append(list);
    return section;
  }

  function checksSection(): HTMLElement {
    const checks = input.checks;
    const coverage = providerChecksCoverage(input);
    const current = checks?.filter((check) => currentCheck(check, input.subject.headSha)) ?? [];
    const counts = new Map<string, number>();
    for (const check of current) {
      const label = providerCheckPresentation(check, input.subject.provider).label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const tally = [...counts].map(([state, count]) => `${count} ${state.toLowerCase()}`).join(' · ');
    const summaryText = coverage === 'unavailable' ? 'Unavailable' : coverage === 'partial' ? `Partial${tally === '' ? '' : ` · ${tally}`}` : current.length === 0 ? 'None on this commit' : tally;
    const section = disclosure('checks', 'CI checks', false);
    section.dataset.geldChecksCoverage = coverage;
    const summary = section.querySelector('[data-geld-review-toggle]');
    summary?.setAttribute('aria-label', `CI checks · ${summaryText}`);
    if (summary !== null && coverage !== 'unavailable' && current.length > 0) {
      const preview = node('span', coverage === 'partial' ? 'Partial · ' : '', 'geld-provider-review__row-preview');
      summary.append(preview);
      let first = true;
      for (const [label, count] of counts) {
        if (!first) preview.append(doc.createTextNode(' · '));
        first = false;
        const part = node('span', '', 'geld-provider-review__check-part');
        const source = current.find((check) => providerCheckPresentation(check, input.subject.provider).label === label);
        if (source !== undefined) part.dataset.geldCheckState = providerCheckPresentation(source, input.subject.provider).state;
        const glyph = source === undefined ? null : providerCheckIcon(input.subject.provider, source, doc);
        if (glyph !== null) part.append(glyph);
        part.append(doc.createTextNode(`${count} ${label.toLowerCase()}`));
        preview.append(part);
      }
    } else summary?.append(node('span', summaryText, 'geld-provider-review__row-preview'));
    if (coverage !== 'complete') section.append(node('p', coverage === 'unavailable' ? 'CI checks could not be read.' : 'Some CI checks could not be read.'));
    else if (checks?.length === 0) section.append(node('p', 'No CI checks reported.'));
    const list = node('ul', '', 'geld-provider-review__checks');
    for (const check of checks ?? []) {
      const presentation = providerCheckPresentation(check, input.subject.provider);
      const row = node('li', '', 'geld-provider-review__check');
      row.dataset.state = currentCheck(check, input.subject.headSha) ? presentation.state : 'previous';
      const key = providerCheckKey(check);
      if (key !== null) row.dataset.geldCheckKey = key;
      const url = check.detailsUrl === undefined ? null : safeUrl(check.detailsUrl);
      row.append(url === null ? node('span', check.name) : link(check.name, url, '', true));
      const status = node('span', '', 'geld-provider-review__check-part');
      status.dataset.geldCheckState = currentCheck(check, input.subject.headSha) ? presentation.state : 'previous';
      const glyph = providerCheckIcon(input.subject.provider, check, doc);
      if (glyph !== null) status.append(glyph);
      status.append(doc.createTextNode(currentCheck(check, input.subject.headSha) ? presentation.label : `Earlier commit · ${presentation.label}`));
      row.append(status);
      if (check.allowFailure === true) row.append(node('span', 'Allowed to fail', 'geld-provider-review__muted'));
      if (check.description !== undefined && check.description !== '') row.append(node('span', check.description, 'geld-provider-review__muted'));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function requirementsSection(): HTMLElement | null {
    const requirements = options.requirements;
    if (requirements === undefined || requirements === null) return null;
    const section = disclosure('requirements', 'Merge checks', false);
    const summary = section.querySelector('[data-geld-review-toggle]');
    const preview = node('span', '', 'geld-provider-review__row-preview');
    for (const state of ['failed', 'pending', 'unknown', 'passed'] as const) {
      const count = requirements.filter(requirement => requirement.state === state).length;
      if (count === 0) continue;
      if (preview.childNodes.length > 0) preview.append(doc.createTextNode(' · '));
      const part = node('span', `${count} ${REQUIREMENT_STATE[state].toLowerCase()}`, 'geld-provider-review__check-part');
      part.dataset.geldCheckState = state;
      preview.append(part);
    }
    if (requirements.length === 0) preview.textContent = 'None supplied';
    summary?.setAttribute('aria-label', `Merge requirements · ${preview.textContent}`);
    summary?.append(preview);
    if (requirements.length === 0) section.append(node('p', 'No merge requirement details were supplied.'));
    const list = node('ul', '', 'geld-provider-review__checks');
    for (const requirement of requirements) {
      const row = node('li', '', 'geld-provider-review__check');
      row.dataset.geldNativeRequirement = requirement.id;
      row.dataset.state = requirement.state;
      const status = node('span', REQUIREMENT_STATE[requirement.state], 'geld-provider-review__check-part');status.dataset.geldCheckState = requirement.state;
      row.append(node('span', requirement.label), status);
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function verdictLabel(bot: BotVerdictRecord): string {
    if (bot.verdict === 'findings') return bot.count === undefined ? 'Findings · count unavailable' : bot.count === 0 ? 'Findings resolved' : countLabel(bot.count, 'open finding');
    if (bot.verdict === 'clean') return 'No findings';
    if (bot.verdict === 'running') return 'Review running';
    if (bot.verdict === 'loading') return 'Reading review';
    if (bot.verdict === 'failed') return bot.reason === undefined ? 'Review failed' : 'Review unavailable';
    return 'Review result unknown';
  }

  function botsSection(): HTMLElement | null {
    const bound = [...new Set((input.bots ?? []).map((bot) => bot.id))];
    const automated = new Map(conversationComments().filter(comment => automatedAuthor(comment.author)).map(comment => [comment.author.id, comment.author]));
    for (const reviewer of input.reviewers ?? []) if (automatedAuthor(reviewer.author)) automated.set(reviewer.author.id, reviewer.author);
    if (bound.length === 0 && automated.size === 0) return null;
    const section = disclosure('bots', 'Review bots', false);
    section.classList.add('geld-provider-review__section--bot-previews');
    const preview = node('span', '', 'geld-provider-review__row-preview');
    preview.dataset.geldReviewPreview = '';section.append(preview);
    const comments = [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])];
    for (const id of bound) {
      const accounts = (input.bots ?? []).filter(bot => bot.id === id);
      const registered = botById(id);
      const presentation = [...authorPresentations.values()].find(value => accounts.some(account => account.authorId === value.authorId) && value.avatar !== undefined);
      const nativeAvatar = presentation?.avatar;
      const nativeUrl = nativeAvatar === undefined ? null : safeUrl(nativeAvatar.src);
      const avatarUrl = nativeUrl !== null && new URL(nativeUrl).protocol === 'https:' ? nativeUrl : registered === null ? null : botAppAvatar(registered, 40);
      const verdict = bots.find((bot) => bot.id === id);
      const row = disclosure(`bot:${id}`, botById(id)?.title ?? id, false);
      row.classList.add('geld-provider-review__standing', 'geld-provider-review__entry');
      row.dataset.geldReviewBot = id;
      row.dataset.state = verdict?.verdict ?? 'unknown';
      const health = verdict === undefined ? 'pending' : botHealth(verdict);
      const summary = newestProviderBotSummary(input, options.comments ?? [], id);
      const summaryUrl = summary === null ? null : sourceLink({ anchor: summary.anchor, kind: 'comment', author: summary.author.login, url: summary.url }, input.subject);
      const compact = summary !== null && summaryUrl !== null ? node('button', '', 'geld-provider-review__status-chip') : node('span', '', 'geld-provider-review__status-chip');
      if (compact instanceof HTMLButtonElement && summary !== null && summaryUrl !== null) {
        compact.type = 'button';
        const generation = renderGeneration, subject = JSON.stringify(input.subject);
        let signature: string | null = null;
        try { signature = options.commentSignature?.(summary) ?? null; } catch { /* A replaced source fails the preview's current check. */ }
        summaryPreviews.bind(compact, {
          label: `${registered?.title ?? id} review`, url: summaryUrl, fallback: summary.body,
          current: () => !destroyed && generation === renderGeneration && subject === JSON.stringify(input.subject)
            && (options.commentSignature?.(summary) ?? null) === signature,
          body: () => [...panel.querySelectorAll<HTMLElement>('.geld-provider-review__source')]
            .find(source => source.dataset.geldSourceId === summary.id && source.dataset.geldSource === summary.anchor && source.dataset.geldSourceUrl === summary.url)
            ?.querySelector<HTMLElement>('.geld-provider-review__body') ?? null,
          open: event => options.onOpenSource?.(summaryUrl, summary.anchor, event),
        });
      }
      compact.dataset.geldBotHealth = health;
      if (avatarUrl !== null) {
        const image = node('img', '', 'geld-provider-review__bot-icon');
        image.src = avatarUrl;image.alt = '';image.setAttribute('aria-hidden', 'true');
        image.width = 20;image.height = 20;image.referrerPolicy = 'no-referrer';image.decoding = 'async';
        shapeMark(image, avatarUrl, avatarUrl === nativeUrl && nativeAvatar?.borderRadius === '50%');
        compact.append(image);
      }
      compact.append(node('span', botById(id)?.title ?? id), node('span', verdict === undefined ? 'No result' : verdict.score === undefined ? verdictLabel(verdict) : `${verdict.score}/5`, 'geld-provider-review__muted'));
      if (compact instanceof HTMLButtonElement) compact.setAttribute('aria-label', `Preview ${registered?.title ?? id} review: ${verdict?.score === undefined ? '' : `${verdict.score}/5, `}${verdict === undefined ? 'No result' : verdictLabel(verdict)}`);
      if (health === 'good') compact.append(digestIcon('check', doc));
      preview.append(compact);
      row.querySelector('[data-geld-review-toggle]')?.replaceChildren(digestIcon('reviews', doc), compact.querySelector('img')?.cloneNode(true) ?? node('span'), node('strong', registered?.title ?? id), node('span', verdict === undefined ? 'No result' : verdictLabel(verdict), 'geld-provider-review__entry-preview'));
      row.dataset.geldBotHealth = health;
      const status = node('span', { good: 'Clear', warn: 'Needs attention', severe: 'Severe findings', bad: 'Review failed', pending: 'Pending' }[health], 'geld-provider-review__bot-health');
      status.dataset.health = health;row.append(status);
      row.append(node('strong', botById(id)?.title ?? id), doc.createTextNode(` · ${verdict === undefined ? 'No verified review result' : verdictLabel(verdict)}`));
      row.append(node('p', [...new Set(accounts.map((account) => account.login ?? account.authorId))].join(', '), 'geld-provider-review__muted'));
      if (verdict?.score !== undefined) row.append(node('p', `Confidence score: ${verdict.score}/5`));
      if (verdict?.reason !== undefined) row.append(node('p', verdict.reason));
      if (verdict?.reviewedSha !== undefined && verdict.reviewedSha !== input.subject.headSha) row.append(node('p', 'Review is for an earlier commit.', 'geld-provider-review__muted'));
      if (verdict !== undefined) {
        const comment = verdict.verdict === 'running' || verdict.verdict === 'loading'
          ? newestProviderBotSummary(input, options.comments ?? [], id)
          : comments.find((candidate) => candidate.anchor === verdict.sourceId);
        if (comment !== undefined && comment !== null) {
          const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
          if (url !== null) row.append(link('View review', url, comment.anchor));
        }
      }
      if (providerBotSupport(input.subject.provider, id)?.formatVerified !== true) row.append(node('p', 'Summary parsing for this service has not been verified on this provider.', 'geld-provider-review__muted'));
      for (const request of options.botRequests ?? []) {
        if (request.botId !== id || !request.current()) continue;
        let control = botRequests.get(request.key);
        if (control === undefined) {
          control = renderProviderBotRequest(row, request, (text) => (options.copyText ?? ((value: string) => doc.defaultView!.navigator.clipboard.writeText(value)))(text));
          botRequests.set(request.key, control);
        } else { row.append(control.element);control.update(request); }
      }
      for (const account of accounts) {
        const author = comments.find(comment => comment.author.id === account.authorId)?.author;
        if (author !== undefined) row.append(authorConversation(author));
      }
      section.append(row);
    }
    const registeredIds = new Set((input.bots ?? []).map(bot => bot.authorId));
    for (const author of automated.values()) {
      if (registeredIds.has(author.id)) continue;
      const reviewer = input.reviewers?.find(reviewer => reviewer.author.id === author.id);
      const label = [...authorPresentations.values()].find(value => value.authorId === author.id)?.displayName ?? author.login;
      const selected = items.filter(item => itemAuthor(item)?.id === author.id);
      const open = selected.filter(item => isOpenStatus(item.status)).length;
      const standing = reviewer === undefined ? countLabel(open, 'open thread') : reviewerLabel(reviewer);
      const compact = node('span', '', 'geld-provider-review__status-chip');compact.dataset.state = reviewer?.state ?? 'commented';
      compact.append(authorAvatar(author), node('span', label), node('span', standing, 'geld-provider-review__muted'));preview.append(compact);
      const row = disclosure(`automated:${author.id}`, '', false);
      row.dataset.geldAutomatedReviewer = author.id;row.classList.add('geld-provider-review__entry');
      row.querySelector('[data-geld-review-toggle]')?.replaceChildren(digestIcon('reviews', doc), authorAvatar(author), node('strong', label), node('span', standing, 'geld-provider-review__entry-preview'));
      row.append(authorConversation(author));
      if (row.children.length === 1) row.append(node('p', reviewer === undefined ? 'No conversation recorded.' : reviewerLabel(reviewer), 'geld-provider-review__muted'));
      section.append(row);
    }
    return section;
  }

  function itemDisclosureKey(item: ReviewItem): string {
    const anchors = new Set(item.sources.map((source) => source.anchor));
    const threads = input.threads.filter((thread) => thread.comments.some((comment) => anchors.has(comment.anchor))).map((thread) => thread.id).sort();
    return `item:${threads.join(':') || item.id}`;
  }

  function itemSection(item: ReviewItem, comments: ReadonlyMap<string, ProviderReviewComment>): ReviewDisclosure {
    const details = disclosure(itemDisclosureKey(item), '', false);
    details.classList.add('geld-provider-review__item');
    details.dataset.geldItem = item.id;
    details.dataset.state = item.status;
    const summary = details.querySelector('[data-geld-review-toggle]');
    if (summary !== null) {
      const title = node('span', '', 'geld-provider-review__item-title');
      inline(title, item.title);
      summary.append(title, node('span', STATUS[item.status], 'geld-provider-review__item-state'));
      const metadata = [item.path === undefined ? '' : `${item.path}${item.line === undefined ? '' : `:${item.line}`}`, [...new Set(item.sources.map((source) => source.author))].join(', '), countLabel(item.sources.length, 'comment')].filter((value) => value !== '').join(' · ');
      summary.append(node('span', metadata, 'geld-provider-review__muted'));
    }
    const originalItem = nativeItems.get(item.id);
    if (originalItem !== undefined) {
      const controls = node('div', '', 'geld-provider-review__source-actions');
      controls.setAttribute('role', 'group');controls.setAttribute('aria-label', 'Copy review item');
      controls.append(copyControl('Copy as Markdown', item.id, 'markdown', () => renderProviderItemMarkdown(item, input.subject, {
        showFix: fixVisible(item.fix, options.suggestedFixes ?? 'all'), sourceStatus: originalItem.status,
        reviewedOnDevice: options.localReviewed?.ids.has(item.id) === true,
      })));
      details.append(controls);
    }
    if (item.rewritten === true) details.append(node('p', 'AI triage · original comments below', 'geld-provider-review__muted'));
    const local = options.localReviewed;
    if (local !== undefined) {
      const reviewed = local.ids.has(item.id);
      const pending = local.pending.has(item.id);
      const controls = node('div', '', 'geld-provider-review__source-actions');
      const button = node('button', reviewed ? 'Undo local review mark' : 'Mark reviewed on this device');
      button.type = 'button';
      button.dataset.geldLocalReviewed = item.id;
      button.disabled = pending;
      button.setAttribute('aria-pressed', String(reviewed));
      if (pending) button.setAttribute('aria-busy', 'true');
      button.addEventListener('click', () => { if (!destroyed && !button.disabled) local.set(item, !reviewed); });
      controls.append(button);
      details.append(controls);
      if (reviewed) {
        const native = nativeItems.get(item.id);
        const note = node('p', `Reviewed on this device. Native status: ${native === undefined ? 'Unavailable' : STATUS[native.status]}.`, 'geld-provider-review__muted');
        note.dataset.geldLocalReviewNotice = '';
        details.append(note);
      }
    }
    if (item.context !== undefined && item.rewritten === true) {
      const context = node('p');
      inline(context, item.context);
      details.append(context);
    }
    if (item.addressed !== undefined) {
      const assessment = node('p', `AI assessment: ${item.addressed.verdict}. ${item.addressed.evidence.join(' ')}`, 'geld-provider-review__muted');
      assessment.dataset.geldAiAddressed = '';
      details.append(assessment);
    }
    if (fixVisible(item.fix, options.suggestedFixes ?? 'all')) {
      const fix = node('div');
      const heading = node('div', '', 'geld-provider-review__source-actions');
      heading.append(node('strong', item.fix.source === 'ai' ? 'Suggested fix · AI' : 'Suggested fix'));
      const value = item.fix.text;
      if (originalItem !== undefined) heading.append(copyControl('Copy suggested fix', item.id, 'fix', () => value));
      fix.append(heading, node('pre', value));
      details.append(fix);
    }
    for (const source of item.sources) {
      const original = comments.get(source.anchor);
      if (original !== undefined) details.append(commentRow(original));
      else {
        const missing = node('p', 'Original comment unavailable.');
        const url = sourceLink(source, input.subject);
        if (url !== null) missing.append(doc.createTextNode(' '), link('View original', url, source.anchor));
        details.append(missing);
      }
    }
    if (item.rewritten !== true) {
      const title = details.querySelector('.geld-provider-review__item-title');
      const body = details.querySelector('.geld-provider-review__body');
      const preview = body?.querySelector('p, h1, h2, h3')?.textContent ?? body?.textContent;
      if (title !== null && preview?.trim()) title.textContent = preview.replace(/\s+/g, ' ').trim().slice(0, 160);
    }
    return details;
  }

  function references(): readonly ProviderReviewReference[] {
    const seen = new Set<string>();
    return (options.references ?? []).filter((reference) => {
      if (!referenceForSubject(reference, input.subject) || seen.has(reference.id)) return false;
      seen.add(reference.id);return true;
    });
  }

  function activityEvents(): readonly ProviderReviewPanelEvent[] {
    const represented = new Set(references().filter((reference) => reference.direction === 'incoming').map((reference) => reference.source.eventId));
    return (options.events ?? []).filter((event) => !represented.has(event.id));
  }

  function referenceRow(reference: ProviderReviewReference): HTMLElement {
    const row = node('div', '', 'geld-provider-review__reference');
    row.dataset.geldReference = reference.id;
    if (reference.target.provider === 'gitlab') {
      row.dataset.geldReferenceNativeId = reference.target.nativeId;
      row.dataset.geldReferenceProject = reference.target.projectId;
    } else row.dataset.geldReferenceIdentity = reference.target.identityBasis;
    row.dataset.geldReferenceNumber = reference.target.number;
    row.dataset.geldReferenceRepository = reference.target.repository;
    row.dataset.geldReferenceKind = reference.target.kind;
    row.dataset.geldReferenceSource = reference.source.anchor ?? 'description';
    const target = node('a', '', 'geld-provider-review__reference-link');
    target.href = reference.target.url;
    target.dataset.geldReferenceRole = 'target';
    target.append(node('span', reference.label, 'geld-provider-review__reference-label'));
    if (reference.title !== null) {
      target.title = reference.title;
      target.append(node('span', reference.title, 'geld-provider-review__reference-title'));
    }
    row.append(target);
    if (reference.source.author !== undefined || reference.source.createdAt !== undefined) {
      const byline = node('div', reference.source.author?.login ?? '', 'geld-provider-review__byline');
      const time = reference.source.createdAt === undefined ? null : timestamp(reference.source.createdAt);
      if (time !== null) byline.append(time);
      row.append(byline);
    }
    if (options.onRevealReference !== undefined) {
      const actions = node('div', '', 'geld-provider-review__source-actions');
      const reveal = node('button', 'View in conversation');
      reveal.dataset.geldReferenceRole = 'source';
      reveal.type = 'button';
      const status = node('span', '', 'geld-provider-review__muted');
      status.setAttribute('role', 'status');
      reveal.addEventListener('click', () => {
        if (destroyed || !row.isConnected || !references().some((current) => JSON.stringify(current) === JSON.stringify(reference))) return;
        status.textContent = options.onRevealReference?.(reference) === true ? '' : 'Original reference is unavailable on this page';
      });
      actions.append(reveal, status);row.append(actions);
    }
    return row;
  }

  function eventRow(event: ProviderReviewPanelEvent): HTMLElement {
    const row = node('div', '', 'geld-provider-review__event');
    row.dataset.geldEvent = event.id;
    row.append(node('strong', event.author.login));
    const body = node('div', '', 'geld-provider-review__body');
    if (options.renderEvent?.(event, body) !== true) inline(body, event.body);
    row.append(body);
    const time = timestamp(event.createdAt);
    if (time !== null) row.append(time);
    const url = safeUrl(event.url, input.subject.origin);
    if (url !== null) row.append(link('View original', url, new URL(url).hash.slice(1)));
    return row;
  }

  function historySections(comments: ReadonlyMap<string, ProviderReviewComment>, ordinary: readonly ProviderReviewComment[]): readonly HTMLElement[] {
    const sections: HTMLElement[] = [];
    const homes = new Map<string, ReviewDisclosure>();
    const openItems = items.filter((item) => isOpenStatus(item.status));
    const attention = openItems.length === 0 ? null : disclosure('history:attention', `Needs attention · ${countLabel(openItems.length, 'open thread')}`, true);
    if (attention !== null) {
      attention.dataset.geldReviewAttention = '';
      for (const item of openItems) {
        const home = itemSection(item, comments);
        homes.set(item.id, home);attention.append(home);
      }
      sections.push(attention);
    }
    const subject = JSON.stringify(input.subject);
    const route = new URL(doc.URL);route.hash = '';
    const itemEntry = (item: ReviewItem): HTMLElement => {
      const home = homes.get(item.id);
      if (home === undefined || attention === null) return itemSection(item, comments);
      const pointer = node('div', '', 'geld-provider-review__source-actions');
      pointer.dataset.geldReviewPointer = item.id;
      const title = node('span');inline(title, item.title);pointer.append(title);
      if (item.path !== undefined) pointer.append(node('span', `${item.path}${item.line === undefined ? '' : `:${item.line}`}`, 'geld-provider-review__muted'));
      pointer.append(node('span', STATUS[item.status], 'geld-provider-review__item-state'));
      const open = node('button', 'Open thread');open.type = 'button';
      open.setAttribute('aria-controls', home.id);
      open.setAttribute('aria-label', `Open thread: ${parseInlineMarkdown(item.title).map((run) => run.text).join('')}`);
      open.addEventListener('click', () => {
        const current = new URL(doc.URL);current.hash = '';
        if (destroyed || !pointer.isConnected || !home.isConnected || subject !== JSON.stringify(input.subject) || current.href !== route.href) return;
        attention.open = true;expanded.set('history:attention', true);
        home.open = true;
        const key = home.dataset.geldReviewKey;
        if (key !== undefined) expanded.set(key, true);
        const summary = home.querySelector<HTMLElement>('[data-geld-review-toggle]');
        if (summary !== null) { summary.focus();summary.scrollIntoView?.({ block: 'center', behavior: 'auto' }); }
      });
      pointer.append(open);return pointer;
    };
    const events = activityEvents();
    const pushes = events.filter((event) => event.kind === 'push' && Number.isFinite(Date.parse(event.createdAt)) && safeUrl(event.url, input.subject.origin) !== null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    interface HistoryEntry { readonly at: number; readonly key: string; readonly render: () => HTMLElement }
    const entries: HistoryEntry[] = [
      ...items.map((item) => ({ at: Math.min(...item.sources.map((source) => Date.parse(comments.get(source.anchor)?.createdAt ?? '')).filter(Number.isFinite)), key: `item:${item.id}`, render: () => itemEntry(item) })),
      ...ordinary.map((comment) => ({ at: Date.parse(comment.author.automated === true ? comment.updatedAt ?? comment.createdAt : comment.createdAt), key: `comment:${comment.id}`, render: () => commentRow(comment) })),
      ...events.filter((event) => !pushes.includes(event)).map((event) => ({ at: Date.parse(event.createdAt), key: `event:${event.id}`, render: () => eventRow(event) })),
    ];
    entries.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
    if (pushes.length === 0) {
      if (entries.length === 0) return [];
      const section = disclosure('history:unpartitioned', 'Conversation history · push boundaries unavailable', true);
      section.dataset.geldReviewHistory = '';
      for (const entry of entries) section.append(entry.render());
      return [...sections, section];
    }
    const boundaries: Array<{ readonly at: number; readonly pushes: ProviderReviewPanelEvent[] }> = [];
    for (const push of pushes) {
      const at = Date.parse(push.createdAt);
      const last = boundaries.at(-1);
      if (last?.at === at) last.pushes.push(push);
      else boundaries.push({ at, pushes: [push] });
    }
    const before = entries.filter((entry) => Number.isFinite(entry.at) && entry.at < (boundaries[0]?.at ?? Infinity));
    const rounds: HTMLElement[] = [];
    for (const [index, boundary] of boundaries.entries()) {
      const next = boundaries[index + 1]?.at ?? Infinity;
      const ids = boundary.pushes.map((push) => push.id);
      const roundKey = `history:push:${ids.join(':')}`;
      if (!expanded.has(roundKey)) {
        const previous = [...panel.querySelectorAll<HTMLElement>('[data-geld-review-round][data-geld-round-events]')].filter((round) => {
          try { const events: unknown = JSON.parse(round.dataset.geldRoundEvents ?? '[]');return Array.isArray(events) && events.some((id: unknown) => typeof id === 'string' && ids.includes(id)); }
          catch { return false; }
        });
        if (previous.length === 1 && previous[0] !== undefined) {
          expanded.set(roundKey, previous[0].dataset.geldReviewOpen === 'true');
          if (touched.has(previous[0].dataset.geldReviewKey ?? '')) touched.add(roundKey);
        }
      }
      const section = disclosure(roundKey, `Push round ${index + 1}${index === boundaries.length - 1 ? ' · Latest recorded push' : ''}`, index === boundaries.length - 1);
      section.dataset.geldReviewRound = ids.join(':');section.dataset.geldRoundEvents = JSON.stringify(ids);
      for (const push of boundary.pushes) section.append(eventRow(push));
      const members = entries.filter((entry) => Number.isFinite(entry.at) && entry.at >= boundary.at && entry.at < next);
      for (const entry of members) section.append(entry.render());
      if (members.length === 0) section.append(node('p', 'No conversation recorded after this push.', 'geld-provider-review__muted'));
      rounds.push(section);
    }
    sections.push(...rounds.reverse());
    if (before.length > 0) {
      const section = disclosure('history:before', 'Before the first recorded push', false);
      for (const entry of before) section.append(entry.render());
      sections.push(section);
    }
    const unknown = entries.filter((entry) => !Number.isFinite(entry.at));
    if (unknown.length > 0) {
      const section = disclosure('history:unknown', 'History with unavailable timestamps', false);
      for (const entry of unknown) section.append(entry.render());
      sections.push(section);
    }
    return sections;
  }

  function reportsSection(): HTMLElement | null {
    const knownHost = (check: RawCheckRun): boolean => {
      if (check.detailsUrl === undefined || safeUrl(check.detailsUrl) === null) return false;
      const url = new URL(check.detailsUrl);
      return CHECK_REPORTERS.some((reporter) => reporter.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) && (reporter.path === undefined || reporter.path.test(url.pathname)) && (reporter.description === undefined || reporter.description.test(check.description ?? '')));
    };
    const reports = (input.checks ?? []).filter((check) => currentCheck(check, input.subject.headSha) && knownHost(check)).sort((a, b) => (Date.parse(a.startedAt ?? a.completedAt ?? '') || 0) - (Date.parse(b.startedAt ?? b.completedAt ?? '') || 0)).flatMap((check) => {
      const report = readCheckReport(check);
      return report === null ? [] : [report];
    });
    if (reports.length === 0) return null;
    const latest = latestReports(reports).latest;
    const section = disclosure('reports', `Reports · ${latest.length}`, false);
    for (const report of latest) {
      const row = node('p');
      row.dataset.geldReport = report.reporter;
      row.dataset.state = report.state;
      const title = `${report.title}${report.project === undefined ? '' : ` · ${report.project}`}`;
      row.append(node('strong', title), doc.createTextNode(` · ${report.headline} `));
      const url = report.url === undefined ? null : safeUrl(report.url);
      if (url !== null) row.append(link('Open report', url, '', true));
      section.append(row);
    }
    return section;
  }

  function previewsSection(): HTMLElement | null {
    const sources = [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])];
    const previews = providerPreviews(input, options.comments ?? []);
    if (previews.length === 0) return null;
    const grouped = latestPreviews(previews);
    const section = disclosure('previews', `Previews · ${grouped.latest.length}`, false);
    function row(preview: (typeof previews)[number], latest: boolean): HTMLElement {
      const value = node('div');
      const source = sources.find((comment) => comment.anchor === preview.anchor);
      if (source === undefined) return value;
      value.dataset.geldPreview = preview.anchor;
      value.append(node('strong', preview.project), node('p', `Posted by ${source.author.login} · Reported status: ${preview.status}`, 'geld-provider-review__muted'));
      if (preview.reason !== undefined) value.append(node('p', preview.reason));
      const destination = providerPreviewDestination(preview, previews, latest);
      if (destination !== null) value.append(link(destination.label, destination.href, '', true));
      if (preview.inspectUrl !== null && preview.inspectUrl !== destination?.href) value.append(link('Inspect', preview.inspectUrl, '', true));
      if (preview.updatedAt !== undefined) { const at = timestamp(preview.updatedAt);if (at !== null) value.append(at); }
      value.append(sourceComment(source));
      return value;
    }
    for (const preview of grouped.latest) section.append(row(preview, true));
    if (grouped.archived.length > 0) {
      const archived = disclosure('previews:earlier', `Earlier previews · ${grouped.archived.length}`, false);
      for (const preview of grouped.archived) archived.append(row(preview, false));
      section.append(archived);
    }
    return section;
  }

  function publicationSection(): HTMLElement | null {
    const publication = options.publication;
    if (publication === undefined || publication.result.status === 'none') return null;
    const { result } = publication;
    const section = node('div', '', 'geld-provider-review__publication');
    section.dataset.geldPublication = result.status;
    const labels: Readonly<Record<ProviderPublicationRead['status'], string>> = {
      none: '', untrusted: 'Published Geld summary', invalid: 'Published summary unavailable',
      stale: 'Earlier published summary', partial: 'Published summary · partially verified', current: 'Published summary · current sources',
    };
    section.append(node('strong', labels[result.status]));
    const candidate = result.candidate;
    if (candidate !== null) {
      const { comment } = candidate;
      const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
      if (url === null) return null;
      const byline = node('p', `Published by ${comment.author.login} · `, 'geld-provider-review__muted');
      const time = timestamp(candidate.generatedAt);
      if (time !== null) byline.append(time, doc.createTextNode(' · '));
      byline.append(link('View original summary', url, comment.anchor));
      section.append(byline);
      const save = publication.save;
      if (result.status === 'untrusted' && save !== undefined) {
        identities.push(renderPublisherIdentity(section, comment, publication.repository, () => save(comment)));
      }
    }
    if (result.status === 'current' || result.status === 'partial') {
      const count = result.matchedItemIds.size;
      section.append(node('p', `${count} ${count === 1 ? 'item checked' : 'items checked'} against current sources.`, 'geld-provider-review__muted'));
    }
    for (const issue of result.issues) section.append(node('p', issue, 'geld-provider-review__muted'));
    return section;
  }

  function digestText(): string {
    const lines = ['# Geld review digest', providerReviewUrl(input.subject), ''];
    if ((options.complete ?? input.complete) === false || (options.unavailable?.length ?? 0) > 0) {
      lines.push('Some review data is unavailable.');
      for (const source of options.unavailable ?? []) lines.push(source.area === 'reviews' ? `Reviews source unavailable: ${source.reason}` : `${source.area}: ${source.reason}`);
      lines.push('');
    }
    const publication = options.publication?.result;
    if (publication !== undefined && publication.status !== 'none') {
      lines.push(`Published summary: ${publication.status}.`);
      const comment = publication.candidate?.comment;
      if (comment !== undefined) {
        const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
        if (url !== null) lines.push(`Publisher: ${comment.author.login} · ${url}`);
      }
    }
    const reviews = reviewStandingSummary();
    if (reviews.coverage !== 'complete') {
      lines.push(reviews.label);
    }
    for (const reviewer of input.reviewers ?? []) lines.push(`- ${reviewer.author.login}: ${reviewerLabel(reviewer)}`);
    const summary = options.ai?.enabled === true && options.ai.state.key === identity ? options.ai.state.summary : undefined;
    if (summary !== undefined) lines.push('', `AI summary: ${summary.tldr}`, '');
    for (const bot of bots) lines.push(`- ${botById(bot.id)?.title ?? bot.id}: ${verdictLabel(bot)}`);
    for (const requirement of options.requirements ?? []) lines.push(`- Merge requirement: ${requirement.label}: ${REQUIREMENT_STATE[requirement.state]}`);
    const coverage = providerChecksCoverage(input);
    if (coverage !== 'complete') lines.push(`CI checks: ${coverage === 'unavailable' ? 'Unavailable' : 'Partial'}`);
    else if (input.checks?.length === 0) lines.push('CI checks: No CI checks reported.');
    for (const check of input.checks ?? []) {
      const url = check.detailsUrl === undefined ? null : safeUrl(check.detailsUrl);
      lines.push(`- CI: ${check.name}: ${providerCheckPresentation(check, input.subject.provider).label}${check.allowFailure === true ? ' (allowed to fail)' : ''}${currentCheck(check, input.subject.headSha) ? '' : ' (earlier commit)'}${url === null ? '' : ` ${url}`}`);
    }
    for (const item of items) {
      lines.push('', `## ${STATUS[item.status]}: ${item.title}`);
      if (options.localReviewed?.ids.has(item.id) === true) lines.push(`Reviewed on this device. Native status: ${STATUS[nativeItems.get(item.id)?.status ?? 'open']}.`);
      if (item.path !== undefined) lines.push(`${item.path}${item.line === undefined ? '' : `:${item.line}`}`);
      for (const source of item.sources) {
        const url = sourceLink(source, input.subject);
        if (url !== null) lines.push(`- ${source.author}: ${url}`);
      }
    }
    for (const comment of options.comments ?? []) {
      const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
      lines.push('', `## Comment by ${comment.author.login}`, comment.body);
      if (url !== null) lines.push(url);
    }
    for (const event of activityEvents()) {
      const url = safeUrl(event.url, input.subject.origin);
      lines.push(`- ${event.author.login}: ${event.body}${url === null ? '' : ` ${url}`}`);
    }
    for (const direction of ['incoming', 'outgoing']) {
      const entries = references().filter((reference) => reference.direction === direction);
      if (entries.length === 0) continue;
      lines.push('', direction === 'incoming' ? '## Incoming references' : '## Outgoing references');
      for (const reference of entries) {
        lines.push(`- ${reference.label}${reference.title === null ? '' : ` · ${reference.title}`}: ${reference.target.url}`);
        if (reference.source.anchor !== null) lines.push(`  ${reference.source.reviewUrl}#${reference.source.anchor}`);
      }
    }
    return lines.join('\n');
  }

  function toolbarMenu(label: string, glyph: DigestIcon, title: string): HTMLDetailsElement {
    const menu = node('details', '', 'geld-provider-review__menu');
    const toggle = node('summary', '', 'geld-provider-review__tool');
    toggle.dataset.geldToolbarControl = glyph;
    toggle.title = title;toggle.setAttribute('aria-label', title);
    toggle.append(digestIcon(glyph, doc), node('span', label, 'geld-provider-review__tool-label'));
    menu.append(toggle);
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();event.stopPropagation();menu.open = false;toggle.focus();
    });
    return menu;
  }

  function render(): void {
    if (destroyed) return;
    const focused = doc.activeElement;
    const toolbarFocus = focused instanceof HTMLElement && panel.contains(focused) ? focused.dataset.geldToolbarControl : undefined;
    const copyFocus = focused instanceof HTMLElement && panel.contains(focused) && !focused.matches(':disabled') ? copyFocusTargets.get(focused) : undefined;
    const commentControlId = focused instanceof HTMLElement && panel.contains(focused) && focused.hasAttribute('data-geld-comment-control') ? focused.id : null;
    const requestFocus = focused instanceof HTMLElement && panel.contains(focused) && focused.closest('[data-geld-bot-request]') !== null ? focused : null;
    const dashboardFocus = focused instanceof HTMLElement && panel.contains(focused)
      ? focused.hasAttribute('data-geld-original-conversation')
        ? { scope: checksScope, section: null }
        : focused.hasAttribute('data-geld-review-toggle')
          ? { scope: checksScope, section: focused.parentElement?.dataset.geldReviewKey ?? null }
          : null
      : null;
    const focusedCheck = focused?.matches('a[href]') === true && panel.contains(focused) ? focused.closest<HTMLElement>('[data-geld-check-key]') : null;
    const checkFocus = focusedCheck === null ? null : { key: focusedCheck.dataset.geldCheckKey, href: focused?.getAttribute('href') };
    const nextChecksScope = JSON.stringify([input.subject.provider, input.subject.origin, input.subject.repository, input.subject.id, input.subject.headSha]);
    const nextReferenceScope = JSON.stringify([input.subject.provider, input.subject.origin, input.subject.repository, input.subject.id, input.subject.headSha]);
    const referenceFocus = focused !== null && panel.contains(focused) ? { id: focused.closest('[data-geld-reference]')?.getAttribute('data-geld-reference'), role: focused.getAttribute('data-geld-reference-role') } : null;
    const reviewedFocus = focused !== null && panel.contains(focused) ? focused.getAttribute('data-geld-local-reviewed') ?? focused.getAttribute('data-geld-local-review-focus') : null;
    nativeTimes.clear();
    for (const time of doc.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
      if (time.closest('[data-geld-ui]') !== null) continue;
      const at = Date.parse(time.dateTime);
      if (Number.isFinite(at) && time.textContent?.trim()) nativeTimes.set(at, time.textContent.trim());
    }
    const ai = options.ai;
    authorPresentations.clear();
    const readPresentation = options.authorPresentation;
    if (readPresentation !== undefined) for (const comment of [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])]) {
      if (sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject) === null) continue;
      try {
        const presentation = readPresentation(comment);
        if (presentation !== null && presentation.authorId === comment.author.id && presentation.displayName.trim() !== '') authorPresentations.set(authorPresentationKey(comment), presentation);
      } catch { /* A replaced native header falls back to the normalized author. */ }
    }
    const publication = options.publication?.result;
    const publicationSignature = publication === undefined ? null : [publication.status, publication.candidate?.comment, publication.candidate?.generatedAt, publication.issues, [...publication.matchedItemIds], options.publication?.save !== undefined];
    for (const request of options.botRequests ?? []) botRequests.get(request.key)?.update(request);
    const requestSignature = options.botRequests?.map((request) => [request.key, request.current(), request.comment.available, request.comment.reason]);
    const commentSignatures = options.commentSignature === undefined ? null : [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])].map((comment) => {
      if (sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject) === null) return null;
      try { return [comment.anchor, options.commentSignature?.(comment)]; } catch { return [comment.anchor, null]; }
    });
    const sources = [...input.threads.flatMap(thread => thread.comments), ...(options.comments ?? [])];
    const nativeSignatures = sources.map(nativeSourceSignature);
    const eventSignatures = options.renderEvent === undefined ? null : (options.events ?? []).map(event => {
      let anchor: string;
      try { anchor = new URL(event.url).hash.slice(1); } catch { return null; }
      const root = doc.getElementById(anchor);
      if (root === null || root.closest('[data-geld-ui]') !== null) return null;
      const body = root.querySelector('.note-body .note-text');
      const authors = [...root.querySelectorAll('.note-header-info > .author-name-link')].map(author => [author.getAttribute('data-user-id'), author.getAttribute('data-username')]);
      return [event.id, root.className, authors, body?.innerHTML ?? root.innerHTML];
    });
    const actionSignatures = sources.map(comment => {
      try { return options.actionsForSource?.(comment).map(action => [action.kind, action.label, action.available, action.reason]); }
      catch { return null; }
    });
    let derived: readonly unknown[] | null = null;
    try { derived = [buildProviderBotVerdicts(input, options.comments ?? []), options.transformItems?.(buildProviderReviewItems(input))]; } catch { /* Invalid input follows the unavailable rendering path. */ }
    const route = new URL(doc.URL);route.hash = '';
    const common = [route.href, (options.agentNotes ?? []).map(note => [note.id, note.signature]), options.comments, options.events, options.references, options.complete, options.unavailable, options.suggestedFixes, options.reviewGrouping, options.hasViewChoice, options.originalConversation?.shown, publicationSignature, [...authorPresentations], options.localReviewed === undefined ? null : [[...options.localReviewed.ids], [...options.localReviewed.pending], options.localReviewed.error], ai === undefined ? null : [ai.enabled, ai.state.kind, ai.state.key, ai.state.stale, ai.state.summary, ai.state.ranAt, ai.state.error, [...ai.state.pending]], options.identifyReviewer?.choices, requestSignature, commentSignatures, nativeSignatures, eventSignatures, actionSignatures, derived, options.onOpenSettings !== undefined, options.onGrouping !== undefined, options.renderComment !== undefined];
    const conversationData = (value: ProviderReviewInput | undefined): unknown => value === undefined ? null : [value.subject, value.threads, value.bots, value.complete, value.closed];
    const conversationSignature = JSON.stringify([common, conversationData(input), conversationData(options.sourceInput)]);
    const signature = JSON.stringify([common, input, options.sourceInput, options.reviewerControls?.available, options.approvalsRequired, options.approvalsLeft, options.requirements]);
    if (signature === lastSignature) {
      syncUpdating();syncTimes();refreshComments();releaseHiddenFocus();
      return;
    }
    lastSignature = signature;
    const statusSignatures = new Map([
      ['bots', JSON.stringify(input.reviewers)],
      ['reviewers', JSON.stringify([input.reviewers, options.reviewerControls?.available, options.approvalsRequired, options.approvalsLeft])],
      ['requirements', JSON.stringify(options.requirements ?? null)],
      ['reports', JSON.stringify(input.checks ?? null)],
      ['checks', JSON.stringify([input.checks, input.checksCoverage])],
    ]);
    const changedStatus = new Set([...statusSignatures].filter(([key, value]) => lastStatusSignatures.get(key) !== value).map(([key]) => key));
    lastStatusSignatures = statusSignatures;
    if (conversationSignature === lastConversationSignature && panel.dataset.state !== 'unavailable') {
      syncStatusRows(changedStatus);
      if (focused instanceof HTMLElement && !focused.isConnected && (doc.activeElement === doc.body || doc.activeElement === focused)) {
        const checkTargets = checkFocus === null ? [] : [...panel.querySelectorAll<HTMLAnchorElement>('[data-geld-check-key] a[href]')].filter(node => node.closest<HTMLElement>('[data-geld-check-key]')?.dataset.geldCheckKey === checkFocus.key && node.getAttribute('href') === checkFocus.href);
        const target = checkFocus !== null
          ? checkTargets.length === 1 ? checkTargets[0] : undefined
          : dashboardFocus?.section !== null && dashboardFocus?.section !== undefined
            ? [...panel.querySelectorAll<HTMLElement>('[data-geld-review-key]')].find(node => node.dataset.geldReviewKey === dashboardFocus.section)?.querySelector<HTMLElement>(':scope > [data-geld-review-toggle]')
            : undefined;
        if (target !== undefined && target !== null && !target.matches(':disabled') && availableFocus(target)) target.focus({ preventScroll: true });
      }
      releaseHiddenFocus();
      return;
    }
    lastConversationSignature = conversationSignature;
    disposeComments();
    const nextRenderScope = JSON.stringify([input.subject.provider, input.subject.origin, input.subject.repository, input.subject.id]);
    if (renderScope !== nextRenderScope) { renderScope = nextRenderScope;clearRenderStates();sourceSlots.clear(); }
    for (const details of panel.querySelectorAll<HTMLDetailsElement>('details[data-geld-body-disclosure]')) {
      const key = details.dataset.geldBodyDisclosure;
      if (key !== undefined) sourceDetails.set(key, details.open);
    }
    for (const section of panel.querySelectorAll<HTMLElement>('[data-geld-review-key]')) {
      const key = section.dataset.geldReviewKey;
      if (key !== undefined) expanded.set(key, section.dataset.geldReviewOpen === 'true');
    }
    for (const control of identities) control.destroy();
    identities = [];
    let key: string;
    try {
      key = providerReviewKey(input.subject);
      items = buildProviderReviewItems(input);
      const source = options.sourceInput;
      const native = source !== undefined && providerReviewKey(source.subject) === key && source.subject.headSha === input.subject.headSha ? buildProviderReviewItems(source) : items;
      nativeItems = new Map(native.map((item) => [item.id, item]));
      items = options.transformItems?.(items) ?? items;
      if (options.localReviewed !== undefined) items = items.map((item) => options.localReviewed?.ids.has(item.id) === true && isOpenStatus(item.status) ? { ...item, status: 'done-manual' } : item);
      bots = buildProviderBotVerdicts(input, options.comments ?? []);
    } catch {
      panel.dataset.state = 'unavailable';
      panel.replaceChildren(node('h2', 'Geld review'), node('p', 'The review source could not be read.'));
      return;
    }
    if (identity !== key) { expanded.clear(); touched.clear(); sourceDetails.clear(); }
    identity = key;
    const activeAi = ai?.state.key === key ? ai : undefined;
    panel.dataset.provider = input.subject.provider;
    panel.dataset.geldReviewHead = input.subject.headSha;
    panel.dataset.state = (options.complete ?? input.complete) === false || (options.unavailable?.length ?? 0) > 0 ? 'partial' : 'ready';
    const header = node('div', '', 'geld-provider-review__header');
    const brand = node('div', '', 'geld-provider-review__brand');
    brand.append(digestIcon('geld', doc), node('h2', 'Geld'));
    header.append(brand);
    const { total, open } = threadCounts(items), resolved = total - open;
    if (total > 0) {
      const progress = node('span', '', 'geld-provider-review__progress');
      const meter = node('progress');meter.max = total;meter.value = resolved;
      meter.setAttribute('aria-label', `${resolved} of ${total} threads resolved${input.complete === false ? ' in available data' : ''}`);
      progress.append(meter, node('span', `${resolved}/${total} resolved`));
      header.append(progress);
    }
    const tools = node('div', '', 'geld-provider-review__tools');
    header.append(tools);
    const copy = node('button', '', 'geld-provider-review__copy geld-provider-review__tool');
    copy.dataset.geldToolbarControl = 'copy';
    copy.title = 'Copy digest';copy.setAttribute('aria-label', 'Copy digest');copy.append(digestIcon('copy', doc));
    copy.type = 'button';
    copy.addEventListener('click', () => {
      if (destroyed || panel.inert || !copy.isConnected) return;
      copy.disabled = true;
      const write = options.copyText ?? ((text: string): Promise<void> => navigator.clipboard.writeText(text));
      const text = digestText();
      Promise.resolve().then(() => write(text)).then(() => { copy.title = 'Copied';copy.setAttribute('aria-label', 'Copied'); }, () => { copy.title = 'Could not copy';copy.setAttribute('aria-label', 'Could not copy'); }).finally(() => { copy.disabled = false; });
    });
    if (options.originalConversation !== undefined) {
      const original = options.originalConversation;
      const toggle = node('button', original.shown ? 'Hide original conversation' : 'Show original conversation', 'geld-provider-toggle');
      toggle.type = 'button';
      toggle.dataset.geldOriginalConversation = '';
      toggle.setAttribute('aria-pressed', String(original.shown));
      toggle.addEventListener('click', () => { if (!destroyed && toggle.isConnected) original.toggle(); });
      tools.append(toggle);
    }
    const flowSlot = node('span', '', 'geld-provider-review__flow-slot');
    flowSlot.dataset.geldFlowSlot = '';tools.append(flowSlot);
    if (options.onGrouping !== undefined) {
      const menu = toolbarMenu(options.reviewGrouping === 'batch' ? 'Push' : 'Type', 'filter', 'Group the digest by');
      const list = node('div', '', 'geld-provider-review__menu-list');
      for (const grouping of ['type', 'batch'] as const) {
        const button = node('button', grouping === 'type' ? 'Type' : 'Push');button.type = 'button';
        button.dataset.geldToolbarControl = 'filter';
        button.setAttribute('aria-pressed', String((options.reviewGrouping ?? 'type') === grouping));
        button.addEventListener('click', () => {
          if (destroyed || !button.isConnected) return;
          button.disabled = true;
          void options.onGrouping?.(grouping).then(() => { menu.open = false; }).catch(() => { button.title = 'Could not save grouping. Try again.'; }).finally(() => { button.disabled = false; });
        });
        list.append(button);
      }
      menu.append(list);tools.append(menu);
    }
    if (options.hasViewChoice === true) {
      const menu = toolbarMenu('View', 'eye', 'How pull requests look');
      const slot = node('div', '', 'geld-provider-review__menu-list');slot.dataset.geldViewSlot = '';
      menu.append(slot);tools.append(menu);
    }
    tools.append(copy);
    if (options.onOpenSettings !== undefined) {
      const settings = node('button', '', 'geld-provider-review__tool geld-provider-review__settings');settings.type = 'button';settings.setAttribute('aria-label', 'Open Geld settings');settings.title = 'Geld settings';settings.append(digestIcon('settings', doc));
      settings.dataset.geldToolbarControl = 'settings';
      const status = node('span', '', 'geld-provider-review__muted');status.setAttribute('role', 'status');
      settings.addEventListener('click', () => {
        if (destroyed || !settings.isConnected) return;
        settings.disabled = true;
        void options.onOpenSettings?.().catch(() => { if (!destroyed) status.textContent = 'Settings could not be opened. Try the extension toolbar.'; }).finally(() => { settings.disabled = false; });
      });
      tools.append(settings, status);
    }
    if (activeAi?.enabled === true) {
      const controls = node('div', '', 'geld-provider-review__source-actions');
      const hasOpenItems = items.some((item) => isOpenStatus(item.status));
      const triage = node('button', !hasOpenItems ? 'Nothing to triage' : activeAi.state.kind === 'running' ? 'Triaging…' : activeAi.state.kind === 'ready' && !activeAi.state.stale ? 'Triage is current' : 'Triage with AI');
      triage.type = 'button';
      triage.dataset.geldAiRun = '';
      triage.disabled = !hasOpenItems || activeAi.state.kind === 'running';
      if (!hasOpenItems) triage.title = 'There are no open review threads to triage.';
      triage.addEventListener('click', () => { if (!destroyed) activeAi.run(); });
      controls.append(triage);
      if (activeAi.state.kind === 'running') {
        const cancel = node('button', 'Cancel AI triage');
        cancel.type = 'button';
        cancel.dataset.geldAiCancel = '';
        cancel.title = 'Stop the remaining triage; the current gateway request may still finish.';
        cancel.addEventListener('click', () => { if (!destroyed) activeAi.cancel(); });
        controls.append(cancel);
      }
      tools.prepend(controls);
    }
    const children: HTMLElement[] = [header];
    const published = publicationSection();
    if (published !== null) children.push(published);
    if (options.localReviewed?.error !== undefined) {
      const error = node('p', `Local review marks: ${options.localReviewed.error}`, 'geld-provider-review__unavailable');
      error.setAttribute('role', 'alert');
      children.push(error);
    }
    if (activeAi?.enabled === true && activeAi.state.error !== undefined) {
      const error = node('p', `AI triage: ${activeAi.state.error}`, 'geld-provider-review__unavailable');
      error.setAttribute('role', 'alert');
      children.push(error);
    }
    if (activeAi?.enabled === true && activeAi.state.summary !== undefined) {
      const summary = node('p', '', 'geld-provider-review__summary');
      summary.dataset.geldAiSummary = '';
      summary.append(node('strong', 'AI summary '), doc.createTextNode(activeAi.state.summary.tldr));
      children.push(summary);
    }
    if (panel.dataset.state === 'partial') {
      const unavailable = node('span', 'Partial review', 'geld-provider-review__muted');
      unavailable.title = 'Some review data is unavailable.';
      unavailable.setAttribute('role', 'status');
      unavailable.dataset.geldReviewCoverage = 'partial';
      brand.append(unavailable);
    }
    children.push(reviewStandings());
    const requirements = requirementsSection();
    if (requirements !== null) children.push(requirements);
    const botSection = botsSection();
    if (botSection !== null) children.push(botSection);
    if (options.agentNotes !== undefined && options.agentNotes.length > 0) {
      const notes = disclosure('agent-notes', `Agent notes · ${options.agentNotes.length}`, false);
      for (const note of options.agentNotes) {
        const section = disclosure(`agent-note:${note.id}`, note.name, false);
        if (note.preview !== '') section.append(node('p', note.preview, 'geld-provider-review__muted'));
        const body = node('div', '', `geld-provider-review__body ${input.subject.provider === 'gitlab' ? 'md' : 'ak-renderer-document'}`);
        body.dataset.geldAgentNote = note.id;renderProviderAgentNote(note, body);section.append(body);
        if (options.onRevealAgentNote !== undefined) {
          const original = node('button', 'View in description', 'geld-provider-toggle');original.type = 'button';
          original.addEventListener('click', () => { if (!destroyed && !panel.inert && original.isConnected) options.onRevealAgentNote?.(note); });section.append(original);
        }
        notes.append(section);
      }
      children.push(notes);
    }
    const reports = reportsSection();
    if (reports !== null) children.push(reports);
    children.push(checksSection());
    const previews = previewsSection();
    if (previews !== null) children.push(previews);
    const comments = new Map(input.threads.flatMap((thread) => thread.comments.map((comment) => [comment.anchor, comment] as const)));
    const ordinary = (options.comments ?? []).filter((comment) => !comments.has(comment.anchor));
    if (items.length === 0) children.push(node('p', panel.dataset.state === 'partial' ? 'No review threads in the available data.' : 'No review threads.'));
    if (options.reviewGrouping === 'batch') children.push(...historySections(comments, ordinary));
    const reviewedAuthors = new Set([...(input.reviewers ?? []).map(reviewer => reviewer.author.id), ...items.map(item => itemAuthor(item)?.id)]);
    const humanComments = ordinary.filter(comment => !automatedAuthor(comment.author) && !reviewedAuthors.has(comment.author.id));
    if (options.reviewGrouping !== 'batch' && humanComments.length > 0) {
      const section = disclosure('comments', `Comments · ${humanComments.length}`, false);
      section.append(...commentRounds(humanComments, 'comments'));
      children.push(section);
    }
    for (const direction of ['incoming', 'outgoing']) {
      const entries = references().filter((reference) => reference.direction === direction);
      if (entries.length === 0) continue;
      const section = disclosure(`references:${direction}`, `${direction === 'incoming' ? 'Incoming' : 'Outgoing'} references · ${entries.length}`, false);
      for (const reference of entries) section.append(referenceRow(reference));
      children.push(section);
    }
    const events = activityEvents();
    if (options.reviewGrouping !== 'batch' && events.length > 0) {
      const section = disclosure('activity', `Activity · ${events.length}`, false);
      const types = new Map<string, ProviderReviewPanelEvent[]>();
      for (const event of events) {
        const type = event.kind === 'push' || event.kind === 'commit' ? 'Commits' : event.kind === 'state' ? 'Status changes' : event.kind === 'task' ? 'Tasks'
          : /approved|requested (?:changes|review)|review request/i.test(event.body) ? 'Review updates'
          : /assigned|unassigned/i.test(event.body) ? 'Assignments' : /label/i.test(event.body) ? 'Labels'
          : /session/i.test(event.body) ? 'Agent sessions' : 'Other updates';
        const group = types.get(type) ?? [];group.push(event);types.set(type, group);
      }
      for (const [type, entries] of types) {
        const group = disclosure(`activity:${type}`, `${type} · ${entries.length}`, false);
        for (const event of entries) group.append(eventRow(event));
        section.append(group);
      }
      children.push(section);
    }
    for (const child of children) wrapSectionContent(child);
    panel.replaceChildren(...children);
    syncUpdating();
    if (toolbarFocus !== undefined && (doc.activeElement === doc.body || doc.activeElement === focused)) {
      [...panel.querySelectorAll<HTMLElement>('[data-geld-toolbar-control]')].find(control => control.dataset.geldToolbarControl === toolbarFocus)?.focus({ preventScroll: true });
    }
    if (copyFocus !== undefined && copyFocus.subject === JSON.stringify(input.subject) && (doc.activeElement === doc.body || doc.activeElement === focused)) {
      const route = new URL(doc.URL);route.hash = '';
      const candidates = [...panel.querySelectorAll<HTMLButtonElement>('[data-geld-item-copy]')].filter((button) => {
        const target = copyFocusTargets.get(button);
        return target !== undefined && target.subject === copyFocus.subject && target.route === copyFocus.route && target.route === route.href
          && target.item === copyFocus.item && target.kind === copyFocus.kind && target.source === copyFocus.source;
      });
      const target = candidates.length === 1 ? candidates[0] : undefined;
      if (target !== undefined && !target.disabled && target.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]), [data-geld-review-open="false"]') === null) target.focus({ preventScroll: true });
    }
    for (const request of options.botRequests ?? []) botRequests.get(request.key)?.update(request);
    for (const [key, control] of botRequests) {
      if (!panel.contains(control.element)) { control.destroy();botRequests.delete(key); }
    }
    if (dashboardFocus !== null && dashboardFocus.scope === nextChecksScope && (doc.activeElement === doc.body || doc.activeElement === focused)) {
      const section = dashboardFocus.section === null ? null : [...panel.querySelectorAll<HTMLElement>('[data-geld-review-key]')].find((entry) => entry.dataset.geldReviewKey === dashboardFocus.section);
      const control = dashboardFocus.section === null ? panel.querySelector<HTMLElement>('[data-geld-original-conversation]') : section?.querySelector<HTMLElement>(':scope > [data-geld-review-toggle]');
      const hiddenParent = section?.parentElement?.closest('[data-geld-review-open="false"]');
      if (control !== null && control !== undefined && !control.matches(':disabled') && !hiddenParent
        && control.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])') === null) control.focus({ preventScroll: true });
    }
    if (requestFocus !== null && panel.contains(requestFocus) && !requestFocus.matches(':disabled') && (doc.activeElement === doc.body || doc.activeElement === focused)) requestFocus.focus({ preventScroll: true });
    if (checkFocus !== null && checksScope === nextChecksScope && (doc.activeElement === doc.body || doc.activeElement === focused)) {
      const targets = [...panel.querySelectorAll<HTMLAnchorElement>('[data-geld-check-key] a[href]')].filter((target) => target.closest<HTMLElement>('[data-geld-check-key]')?.dataset.geldCheckKey === checkFocus.key && target.getAttribute('href') === checkFocus.href);
      const target = targets.length === 1 ? targets[0] : undefined;
      if (target !== undefined && target.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]), [data-geld-review-open="false"]') === null) target.focus({ preventScroll: true });
    }
    checksScope = nextChecksScope;
    if (referenceFocus?.id != null && referenceScope === nextReferenceScope && (doc.activeElement === doc.body || doc.activeElement === focused) && (referenceFocus.role === 'target' || referenceFocus.role === 'source')) {
      const row = [...panel.querySelectorAll<HTMLElement>('[data-geld-reference]')].find((entry) => entry.dataset.geldReference === referenceFocus.id);
      const control = row?.querySelector<HTMLElement>(`[data-geld-reference-role="${referenceFocus.role}"]`);
      if (control !== null && control !== undefined && control.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]), [data-geld-review-open="false"]') === null) control.focus({ preventScroll: true });
    }
    referenceScope = nextReferenceScope;
    for (const key of sourceSlots.keys()) if (!activeSourceKeys.has(key)) sourceSlots.delete(key);
    for (const [key, memo] of renderStates) if (!activeRenderSources.has(key)) { memo.state.clear();renderStates.delete(key); }
    for (const callback of mountCallbacks.splice(0)) callback();
    if (commentControlId !== null && doc.defaultView !== null) {
      const generation = renderGeneration;
      commentFocusFrame = doc.defaultView.requestAnimationFrame(() => {
        commentFocusFrame = null;
        const control = doc.getElementById(commentControlId);
        if (!destroyed && generation === renderGeneration && control instanceof HTMLElement && panel.contains(control) && !control.matches(':disabled')
          && control.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]), [data-geld-review-open="false"]') === null) control.focus({ preventScroll: true });
      });
    }
    if (reviewedFocus !== null) {
      const button = [...panel.querySelectorAll<HTMLButtonElement>('[data-geld-local-reviewed]')].find((candidate) => candidate.dataset.geldLocalReviewed === reviewedFocus);
      if (button !== undefined) {
        for (let parent = button.parentElement; parent !== null && parent !== panel; parent = parent.parentElement) {
          const key = parent.dataset.geldReviewKey;
          if (key !== undefined) {
            parent.dataset.geldReviewOpen = 'true';
            parent.querySelector(':scope > [data-geld-review-toggle]')?.setAttribute('aria-expanded', 'true');
            expanded.set(key, true);
          } else if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
        if (!button.disabled) button.focus({ preventScroll: true });
        else {
          const summary = button.closest('[data-geld-item]')?.querySelector<HTMLElement>(':scope > [data-geld-review-toggle]');
          if (summary !== null && summary !== undefined) {
            summary.dataset.geldLocalReviewFocus = reviewedFocus;
            summary.focus({ preventScroll: true });
          }
        }
      }
    }
  }

  render();
  return {
    element: panel,
    update(nextInput, nextOptions = options) {
      panel.inert = false;
      panel.hidden = false;
      input = nextInput;
      options = nextOptions;
      render();
    },
    suspend() {
      if (destroyed) return;
      panel.inert = true;panel.hidden = true;disposeComments();lastSignature = '';lastConversationSignature = '';
    },
    destroy() {
      destroyed = true;
      summaryPreviews.destroy();
      doc.removeEventListener('pointerdown', dismissMenus);
      disposeComments();clearRenderStates();sourceSlots.clear();
      for (const control of identities) control.destroy();
      for (const control of botRequests.values()) control.destroy();
      botRequests.clear();
      identities = [];
      expanded.clear();touched.clear();
      sourceDetails.clear();
      authorPresentations.clear();
      panel.remove();
    },
  };
}
