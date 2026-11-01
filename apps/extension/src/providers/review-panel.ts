import { botById, buildProviderBotVerdicts, buildProviderReviewItems, CHECK_REPORTERS, fixVisible, isOpenStatus, latestPreviews, latestReports, parseInlineMarkdown, previewDocFromMarkdown, previewHostById, providerBotSupport, providerReviewKey, providerReviewUrl, readCheckReport, renderProviderItemMarkdown, sourceLink } from '@geld/review';
import type { BotVerdictRecord, ProviderPublicationRead, ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, RawCheckRun, ReviewItem, ReviewItemStatus, ReviewerState } from '@geld/review';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderAiState } from './ai';
import { captureProviderSourceSelection } from './source-selection';
import type { ProviderSourceActionContext, ProviderSourceSelection } from './source-selection';

export type { ProviderSourceActionContext } from './source-selection';
import { renderReviewerIdentity } from './reviewer-identity';
import { referenceForSubject } from './references';
import type { ProviderReviewReference } from './references';
import { renderPublisherIdentity } from './publisher-identity';
import { providerCheckKey, providerCheckPresentation, providerChecksCoverage } from './ci-checks';
import { providerCheckIcon } from './ci-icons';
import type { ReviewerIdentityChoice, ReviewerIdentityControl } from './reviewer-identity';

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
  readonly updating?: boolean;
  readonly version?: number;
  readonly actionsForSource?: (comment: ProviderReviewComment) => readonly ProviderReviewSourceAction[];
  readonly renderComment?: (comment: ProviderReviewComment, host: HTMLElement) => boolean;
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
  const request = reviewer.reviewRequest === 'pending' ? 'Review requested' : reviewer.reviewRequest === 'unknown' ? 'Request state unavailable' : null;
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

let nextPanelId = 0;

export function renderProviderReviewPanel(host: HTMLElement, initialInput: ProviderReviewInput, initialOptions: ProviderReviewPanelOptions = {}): ProviderReviewPanel {
  const doc = host.ownerDocument;
  const panelId = `geld-provider-review-${++nextPanelId}`;
  const expanded = new Map<string, boolean>();
  const sourceDetails = new Map<string, boolean>();
  let input = initialInput;
  let options = initialOptions;
  let identity = '';
  let checksScope: string | null = null;
  let referenceScope: string | null = null;
  let destroyed = false;
  let items: readonly ReviewItem[] = [];
  let nativeItems: ReadonlyMap<string, ReviewItem> = new Map();
  const authorPresentations = new Map<string, ProviderReviewAuthorPresentation>();
  let bots: readonly BotVerdictRecord[] = [];
  let identities: ReviewerIdentityControl[] = [];
  const nativeTimes = new Map<number, string>();
  let lastSignature = '';

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag);
    value.dataset.geldUi = '';
    if (text !== '') value.textContent = text;
    if (className !== '') value.className = className;
    return value;
  }

  const panel = node('section', '', 'geld-provider-review');
  panel.setAttribute('aria-label', 'Geld review digest');
  host.append(panel);

  function disclosure(key: string, label: string, open: boolean): HTMLDetailsElement {
    const details = node('details', '', 'geld-provider-review__section');
    details.dataset.geldReviewKey = key;
    details.open = expanded.get(key) ?? open;
    details.append(node('summary', label));
    details.addEventListener('toggle', () => expanded.set(key, details.open));
    return details;
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
    if (options.renderComment?.(comment, body) === true) {
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
          const current = (): boolean => !destroyed && body.isConnected && article.isConnected && article.dataset.geldSource === comment.anchor;
          if (!current()) return;
          button.disabled = true;
          void action.activate({ ...(selection === undefined ? {} : { selection }), current }).then((activated) => {
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

  function reviewStandings(): HTMLElement {
    const reviewers = input.reviewers;
    const approvals = reviewers?.filter((reviewer) => reviewer.state === 'approved').length ?? 0;
    const changes = reviewers?.filter((reviewer) => reviewer.state === 'changes_requested').length ?? 0;
    const pending = reviewers?.filter(reviewerRequested).length ?? 0;
    const required = options.approvalsRequired;
    const left = options.approvalsLeft;
    const tally = typeof required === 'number' && typeof left === 'number' && Number.isSafeInteger(required) && Number.isSafeInteger(left) && required > 0 && left >= 0 && left <= required
      ? `${required - left}/${required} required approvals`
      : countLabel(approvals, 'approval');
    const section = disclosure('reviewers', `Reviews · ${reviewers === undefined ? 'Unavailable' : `${tally}${changes === 0 ? '' : ` · ${countLabel(changes, 'change request')}`}${pending === 0 ? '' : ` · ${countLabel(pending, 'pending review')}`}`}`, false);
    if (reviewers === undefined || reviewers.length === 0) {
      section.append(node('p', reviewers === undefined ? 'Review standings could not be read.' : 'No reviewer standings.'));
      return section;
    }
    const list = node('ul');
    for (const reviewer of reviewers) {
      const row = node('li', '', 'geld-provider-review__standing');
      row.dataset.state = reviewer.state;
      if (reviewer.reviewRequest !== undefined) row.dataset.reviewRequest = reviewer.reviewRequest;
      const url = reviewer.url === undefined ? null : safeUrl(reviewer.url, input.subject.origin);
      row.append(url === null ? node('span', reviewer.author.login) : link(reviewer.author.login, url, reviewer.anchor ?? ''));
      if (reviewer.author.automated === true) row.append(node('span', 'Automated account', 'geld-provider-review__muted'));
      if (reviewer.state !== 'pending' && reviewer.reviewRequest !== undefined && reviewer.reviewRequest !== 'not-pending') {
        row.append(node('span', STANDING[reviewer.state]), node('span', ` · ${reviewer.reviewRequest === 'pending' ? 'Review requested' : 'Request state unavailable'}`, 'geld-provider-review__muted'));
      } else row.append(node('span', reviewerLabel(reviewer)));
      list.append(row);
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
    const section = disclosure('checks', `CI checks · ${summaryText}`, false);
    section.dataset.geldChecksCoverage = coverage;
    const summary = section.querySelector('summary');
    if (summary !== null && coverage !== 'unavailable' && current.length > 0) {
      summary.replaceChildren(doc.createTextNode(`CI checks · ${coverage === 'partial' ? 'Partial · ' : ''}`));
      let first = true;
      for (const [label, count] of counts) {
        if (!first) summary.append(doc.createTextNode(' · '));
        first = false;
        const part = node('span', '', 'geld-provider-review__check-part');
        const source = current.find((check) => providerCheckPresentation(check, input.subject.provider).label === label);
        const glyph = source === undefined ? null : providerCheckIcon(input.subject.provider, source, doc);
        if (glyph !== null) part.append(glyph);
        part.append(doc.createTextNode(`${count} ${label.toLowerCase()}`));
        summary.append(part);
      }
    }
    if (coverage !== 'complete') section.append(node('p', coverage === 'unavailable' ? 'CI checks could not be read.' : 'Some CI checks could not be read.'));
    else if (checks?.length === 0) section.append(node('p', 'No CI checks reported.'));
    const list = node('ul');
    for (const check of checks ?? []) {
      const presentation = providerCheckPresentation(check, input.subject.provider);
      const row = node('li', '', 'geld-provider-review__check');
      row.dataset.state = currentCheck(check, input.subject.headSha) ? presentation.state : 'previous';
      const key = providerCheckKey(check);
      if (key !== null) row.dataset.geldCheckKey = key;
      const url = check.detailsUrl === undefined ? null : safeUrl(check.detailsUrl);
      row.append(url === null ? node('span', check.name) : link(check.name, url, '', true));
      const status = node('span', '', 'geld-provider-review__check-part');
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
    const section = disclosure('requirements', `Merge requirements · ${requirements.length} shown`, false);
    if (requirements.length === 0) section.append(node('p', 'No merge requirement details were supplied.'));
    const list = node('ul');
    for (const requirement of requirements) {
      const row = node('li', '', 'geld-provider-review__check');
      row.dataset.geldNativeRequirement = requirement.id;
      row.dataset.state = requirement.state;
      row.append(node('span', requirement.label), node('span', REQUIREMENT_STATE[requirement.state]));
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
    if (bot.verdict === 'failed') return 'Review failed';
    return 'Review result unknown';
  }

  function botsSection(): HTMLElement | null {
    const bound = [...new Set((input.bots ?? []).map((bot) => bot.id))];
    if (bound.length === 0) return null;
    const section = disclosure('bots', `Review bots · ${bound.length}`, true);
    const comments = [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])];
    for (const id of bound) {
      const verdict = bots.find((bot) => bot.id === id);
      const row = node('div', '', 'geld-provider-review__standing');
      row.dataset.geldReviewBot = id;
      row.dataset.state = verdict?.verdict ?? 'unknown';
      row.append(node('strong', botById(id)?.title ?? id), doc.createTextNode(` · ${verdict === undefined ? 'No verified review result' : verdictLabel(verdict)}`));
      const accounts = (input.bots ?? []).filter((bot) => bot.id === id);
      row.append(node('p', [...new Set(accounts.map((account) => account.login ?? account.authorId))].join(', '), 'geld-provider-review__muted'));
      if (verdict?.score !== undefined) row.append(node('p', `Confidence score: ${verdict.score}/5`));
      if (verdict?.reason !== undefined) row.append(node('p', verdict.reason));
      if (verdict?.reviewedSha !== undefined && verdict.reviewedSha !== input.subject.headSha) row.append(node('p', 'Review is for an earlier commit.', 'geld-provider-review__muted'));
      if (verdict?.sourceId !== undefined) {
        const comment = comments.find((candidate) => candidate.anchor === verdict.sourceId);
        if (comment !== undefined) {
          const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
          if (url !== null) row.append(link('View review', url, comment.anchor));
        }
      }
      if (providerBotSupport(input.subject.provider, id)?.formatVerified !== true) row.append(node('p', 'Summary parsing for this service has not been verified on this provider.', 'geld-provider-review__muted'));
      section.append(row);
    }
    return section;
  }

  function itemSection(item: ReviewItem, comments: ReadonlyMap<string, ProviderReviewComment>): HTMLDetailsElement {
    const anchors = new Set(item.sources.map((source) => source.anchor));
    const threads = input.threads.filter((thread) => thread.comments.some((comment) => anchors.has(comment.anchor))).map((thread) => thread.id).sort();
    const details = disclosure(`item:${threads.join(':') || item.id}`, '', false);
    details.classList.add('geld-provider-review__item');
    details.dataset.geldItem = item.id;
    details.dataset.state = item.status;
    const summary = details.querySelector('summary');
    if (summary !== null) {
      const title = node('span');
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
    if (item.context !== undefined) {
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
      if (original !== undefined) details.append(sourceComment(original));
      else {
        const missing = node('p', 'Original comment unavailable.');
        const url = sourceLink(source, input.subject);
        if (url !== null) missing.append(doc.createTextNode(' '), link('View original', url, source.anchor));
        details.append(missing);
      }
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
    row.dataset.geldReferenceNativeId = reference.target.nativeId;
    row.dataset.geldReferenceProject = reference.target.projectId;
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
    row.append(node('strong', event.author.login), doc.createTextNode(` ${event.body} `));
    const time = timestamp(event.createdAt);
    if (time !== null) row.append(time);
    const url = safeUrl(event.url, input.subject.origin);
    if (url !== null) row.append(link('View original', url, new URL(url).hash.slice(1)));
    return row;
  }

  function historySections(comments: ReadonlyMap<string, ProviderReviewComment>, ordinary: readonly ProviderReviewComment[]): readonly HTMLElement[] {
    const sections: HTMLElement[] = [];
    const homes = new Map<string, HTMLDetailsElement>();
    const openItems = items.filter((item) => isOpenStatus(item.status));
    const attention = openItems.length === 0 ? null : disclosure('history:attention', `Needs attention · ${countLabel(openItems.length, 'open thread')}`, true);
    if (attention !== null) {
      attention.dataset.geldReviewAttention = '';
      for (const item of openItems) {
        const home = itemSection(item, comments);
        home.id = `${panelId}-item-${item.id}`;
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
        const summary = home.querySelector('summary');
        if (summary !== null) { summary.focus();summary.scrollIntoView?.({ block: 'center', behavior: 'auto' }); }
      });
      pointer.append(open);return pointer;
    };
    const events = activityEvents();
    const pushes = events.filter((event) => event.kind === 'push' && Number.isFinite(Date.parse(event.createdAt)) && safeUrl(event.url, input.subject.origin) !== null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    interface HistoryEntry { readonly at: number; readonly key: string; readonly render: () => HTMLElement }
    const entries: HistoryEntry[] = [
      ...items.map((item) => ({ at: Math.min(...item.sources.map((source) => Date.parse(comments.get(source.anchor)?.createdAt ?? '')).filter(Number.isFinite)), key: `item:${item.id}`, render: () => itemEntry(item) })),
      ...ordinary.map((comment) => ({ at: Date.parse(comment.author.automated === true ? comment.updatedAt ?? comment.createdAt : comment.createdAt), key: `comment:${comment.id}`, render: () => sourceComment(comment) })),
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
      const section = disclosure(`history:push:${boundary.pushes.map((push) => push.id).join(':')}`, `Push round ${index + 1}${index === boundaries.length - 1 ? ' · Latest recorded push' : ''}`, index === boundaries.length - 1);
      section.dataset.geldReviewRound = boundary.pushes.map((push) => push.id).join(':');
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
    const generic = previewHostById('generic');
    if (generic === null) return null;
    const sources = [...input.threads.flatMap((thread) => thread.comments), ...(options.comments ?? [])].filter((comment) => comment.author.automated === true && sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject) !== null);
    sources.sort((a, b) => Date.parse(a.updatedAt ?? a.createdAt) - Date.parse(b.updatedAt ?? b.createdAt));
    const previews = sources.flatMap((comment) => generic.parse(previewDocFromMarkdown(comment.author.login, comment.anchor, comment.body, comment.updatedAt ?? comment.createdAt)).filter((preview) => preview.url !== null && safeUrl(preview.url) !== null && new URL(preview.url).origin !== input.subject.origin).map((preview) => ({ ...preview, host: `native-account:${comment.author.id}` })));
    if (previews.length === 0) return null;
    const grouped = latestPreviews(previews);
    const section = disclosure('previews', `Preview links · ${grouped.latest.length}`, false);
    function row(preview: (typeof previews)[number]): HTMLElement {
      const value = node('div');
      const source = sources.find((comment) => comment.anchor === preview.anchor);
      if (source === undefined || preview.url === null) return value;
      value.dataset.geldPreview = preview.anchor;
      value.append(link(preview.project, preview.url, '', true), node('p', `Posted by ${source.author.login} · Reported status: ${preview.status}`, 'geld-provider-review__muted'));
      if (preview.inspectUrl !== null && safeUrl(preview.inspectUrl) !== null) value.append(link('Inspect', preview.inspectUrl, '', true));
      value.append(sourceComment(source));
      return value;
    }
    for (const preview of grouped.latest) section.append(row(preview));
    if (grouped.archived.length > 0) {
      const archived = disclosure('previews:earlier', `Earlier preview links · ${grouped.archived.length}`, false);
      for (const preview of grouped.archived) archived.append(row(preview));
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
    if ((options.complete ?? input.complete) === false || (options.unavailable?.length ?? 0) > 0) lines.push('Some review data is unavailable.', '');
    const publication = options.publication?.result;
    if (publication !== undefined && publication.status !== 'none') {
      lines.push(`Published summary: ${publication.status}.`);
      const comment = publication.candidate?.comment;
      if (comment !== undefined) {
        const url = sourceLink({ anchor: comment.anchor, kind: 'comment', author: comment.author.login, url: comment.url }, input.subject);
        if (url !== null) lines.push(`Publisher: ${comment.author.login} · ${url}`);
      }
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

  function render(): void {
    if (destroyed) return;
    const focused = doc.activeElement;
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
    const signature = JSON.stringify([input, options.comments, options.events, options.references, options.complete, options.unavailable, options.approvalsRequired, options.approvalsLeft, options.requirements, options.updating, options.version, options.suggestedFixes, options.reviewGrouping, publicationSignature, [...authorPresentations], options.localReviewed === undefined ? null : [[...options.localReviewed.ids], [...options.localReviewed.pending], options.localReviewed.error], ai === undefined ? null : [ai.enabled, ai.state.kind, ai.state.key, ai.state.stale, ai.state.summary, ai.state.ranAt, ai.state.error, [...ai.state.pending]], options.identifyReviewer?.choices, nativeTimes.size]);
    if (signature === lastSignature) {
      for (const time of panel.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
        const native = nativeTimes.get(Date.parse(time.dateTime));
        if (native !== undefined && time.textContent !== native) time.textContent = native;
      }
      return;
    }
    lastSignature = signature;
    for (const details of panel.querySelectorAll<HTMLDetailsElement>('details[data-geld-body-disclosure]')) {
      const key = details.dataset.geldBodyDisclosure;
      if (key !== undefined) sourceDetails.set(key, details.open);
    }
    for (const details of panel.querySelectorAll<HTMLDetailsElement>('details[data-geld-review-key]')) {
      const key = details.dataset.geldReviewKey;
      if (key !== undefined) expanded.set(key, details.open);
    }
    for (const control of identities) control.destroy();
    identities = [];
    let key: string;
    try {
      key = providerReviewKey(input.subject);
      items = buildProviderReviewItems(input);
      nativeItems = new Map(items.map((item) => [item.id, item]));
      items = options.transformItems?.(items) ?? items;
      if (options.localReviewed !== undefined) items = items.map((item) => options.localReviewed?.ids.has(item.id) === true && isOpenStatus(item.status) ? { ...item, status: 'done-manual' } : item);
      bots = buildProviderBotVerdicts(input, options.comments ?? []);
    } catch {
      panel.dataset.state = 'unavailable';
      panel.replaceChildren(node('h2', 'Geld review'), node('p', 'The review source could not be read.'));
      return;
    }
    if (identity !== key) { expanded.clear(); sourceDetails.clear(); }
    identity = key;
    const activeAi = ai?.state.key === key ? ai : undefined;
    panel.dataset.provider = input.subject.provider;
    panel.dataset.geldReviewHead = input.subject.headSha;
    panel.dataset.state = (options.complete ?? input.complete) === false || (options.unavailable?.length ?? 0) > 0 ? 'partial' : 'ready';
    const header = node('div', '', 'geld-provider-review__header');
    header.append(node('h2', 'Geld review'));
    if (options.updating === true) {
      const updating = node('span', 'Updating…', 'geld-provider-review__muted');
      updating.setAttribute('role', 'status');
      header.append(updating);
    }
    const copy = node('button', 'Copy digest', 'geld-provider-review__copy');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      copy.disabled = true;
      const write = options.copyText ?? ((text: string): Promise<void> => navigator.clipboard.writeText(text));
      const text = digestText();
      Promise.resolve().then(() => write(text)).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Could not copy'; }).finally(() => { copy.disabled = false; });
    });
    header.append(copy);
    if (activeAi?.enabled === true) {
      const controls = node('div', '', 'geld-provider-review__source-actions');
      const triage = node('button', activeAi.state.kind === 'running' ? 'Triaging…' : activeAi.state.kind === 'ready' && !activeAi.state.stale ? 'Triage is current' : 'Triage with AI');
      triage.type = 'button';
      triage.dataset.geldAiRun = '';
      triage.disabled = activeAi.state.kind === 'running';
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
      header.append(controls);
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
      const unavailable = node('div', '', 'geld-provider-review__unavailable');
      unavailable.setAttribute('role', 'status');
      unavailable.append(node('p', 'Some review data is unavailable.'));
      for (const source of options.unavailable ?? []) unavailable.append(node('p', `${source.area}: ${source.reason}`));
      children.push(unavailable);
    }
    children.push(reviewStandings(), checksSection());
    const requirements = requirementsSection();
    if (requirements !== null) children.push(requirements);
    const botSection = botsSection();
    if (botSection !== null) children.push(botSection);
    const reports = reportsSection();
    if (reports !== null) children.push(reports);
    const previews = previewsSection();
    if (previews !== null) children.push(previews);
    const comments = new Map(input.threads.flatMap((thread) => thread.comments.map((comment) => [comment.anchor, comment] as const)));
    const ordinary = (options.comments ?? []).filter((comment) => !comments.has(comment.anchor));
    if (items.length === 0) children.push(node('p', panel.dataset.state === 'partial' ? 'No review threads in the available data.' : 'No review threads.'));
    if (options.reviewGrouping === 'batch') children.push(...historySections(comments, ordinary));
    else for (const group of GROUPS) {
      const members = items.filter((item) => group.statuses.includes(item.status));
      if (members.length === 0) continue;
      const section = disclosure(`group:${group.id}`, `${group.label} · ${members.length}`, group.open);
      section.dataset.geldReviewGroup = group.id;
      for (const item of members) section.append(itemSection(item, comments));
      children.push(section);
    }
    if (options.reviewGrouping !== 'batch' && ordinary.length > 0) {
      const section = disclosure('comments', `Comments · ${ordinary.length}`, false);
      for (const comment of ordinary) section.append(sourceComment(comment));
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
      for (const event of events) {
        section.append(eventRow(event));
      }
      children.push(section);
    }
    panel.replaceChildren(...children);
    if (checkFocus !== null && checksScope === nextChecksScope && (doc.activeElement === doc.body || doc.activeElement === focused)) {
      const targets = [...panel.querySelectorAll<HTMLAnchorElement>('[data-geld-check-key] a[href]')].filter((target) => target.closest<HTMLElement>('[data-geld-check-key]')?.dataset.geldCheckKey === checkFocus.key && target.getAttribute('href') === checkFocus.href);
      const target = targets.length === 1 ? targets[0] : undefined;
      if (target !== undefined && target.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])') === null) target.focus({ preventScroll: true });
    }
    checksScope = nextChecksScope;
    if (referenceFocus?.id != null && referenceScope === nextReferenceScope && (doc.activeElement === doc.body || doc.activeElement === focused) && (referenceFocus.role === 'target' || referenceFocus.role === 'source')) {
      const row = [...panel.querySelectorAll<HTMLElement>('[data-geld-reference]')].find((entry) => entry.dataset.geldReference === referenceFocus.id);
      const control = row?.querySelector<HTMLElement>(`[data-geld-reference-role="${referenceFocus.role}"]`);
      if (control !== null && control !== undefined && control.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])') === null) control.focus({ preventScroll: true });
    }
    referenceScope = nextReferenceScope;
    if (reviewedFocus !== null) {
      const button = [...panel.querySelectorAll<HTMLButtonElement>('[data-geld-local-reviewed]')].find((candidate) => candidate.dataset.geldLocalReviewed === reviewedFocus);
      if (button !== undefined) {
        for (let parent = button.parentElement; parent !== null && parent !== panel; parent = parent.parentElement) {
          if (!(parent instanceof HTMLDetailsElement)) continue;
          parent.open = true;
          const key = parent.dataset.geldReviewKey;
          if (key !== undefined) expanded.set(key, true);
        }
        if (!button.disabled) button.focus({ preventScroll: true });
        else {
          const summary = button.closest('details[data-geld-item]')?.querySelector<HTMLElement>(':scope > summary');
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
      input = nextInput;
      options = nextOptions;
      render();
    },
    destroy() {
      destroyed = true;
      for (const control of identities) control.destroy();
      identities = [];
      expanded.clear();
      sourceDetails.clear();
      authorPresentations.clear();
      panel.remove();
    },
  };
}
