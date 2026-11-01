import { botById, buildProviderBotVerdicts, buildProviderReviewItems, CHECK_REPORTERS, fixVisible, isOpenStatus, latestPreviews, latestReports, parseInlineMarkdown, previewDocFromMarkdown, previewHostById, providerBotSupport, providerReviewKey, providerReviewUrl, readCheckReport, sourceLink } from '@geld/review';
import type { BotVerdictRecord, ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, RawCheckRun, ReviewItem, ReviewItemStatus, ReviewerState } from '@geld/review';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderAiState } from './ai';
import { renderReviewerIdentity } from './reviewer-identity';
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

export interface ProviderReviewPanelOptions {
  readonly updating?: boolean;
  readonly version?: number;
  readonly actionsForSource?: (comment: ProviderReviewComment) => readonly ProviderReviewSourceAction[];
  readonly renderComment?: (comment: ProviderReviewComment, host: HTMLElement) => boolean;
  readonly onActionComplete?: () => void;
  readonly comments?: readonly ProviderReviewComment[];
  readonly events?: readonly ProviderReviewPanelEvent[];
  readonly complete?: boolean;
  readonly unavailable?: readonly { readonly area: string; readonly reason: string }[];
  readonly approvalsRequired?: number | null;
  readonly approvalsLeft?: number | null;
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
}

export interface ProviderReviewSourceAction {
  readonly kind: string;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
  activate(): Promise<boolean>;
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

function safeUrl(value: string, origin?: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') return null;
    return origin === undefined || url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

function checkState(check: RawCheckRun): string {
  if (['queued', 'pending', 'in_progress', 'running', 'waiting', 'requested'].includes(check.status)) return 'Running';
  if (check.status !== 'completed') return 'Unknown';
  if (check.conclusion === 'success') return 'Passed';
  if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(check.conclusion ?? '')) return 'Failed';
  if (check.conclusion === 'skipped') return 'Skipped';
  if (check.conclusion === 'cancelled' || check.conclusion === 'canceled') return 'Cancelled';
  if (check.conclusion === 'neutral') return 'Neutral';
  return 'Unknown';
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function currentCheck(check: RawCheckRun, head: string): boolean {
  return check.sha === head || check.reviewHeadSha === head;
}

export function renderProviderReviewPanel(host: HTMLElement, initialInput: ProviderReviewInput, initialOptions: ProviderReviewPanelOptions = {}): ProviderReviewPanel {
  const doc = host.ownerDocument;
  const expanded = new Map<string, boolean>();
  const sourceDetails = new Map<string, boolean>();
  let input = initialInput;
  let options = initialOptions;
  let identity = '';
  let destroyed = false;
  let items: readonly ReviewItem[] = [];
  let nativeItems: ReadonlyMap<string, ReviewItem> = new Map();
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

  function sourceComment(comment: ProviderReviewComment): HTMLElement {
    const article = node('article', '', 'geld-provider-review__source');
    article.dataset.geldSource = comment.anchor;
    const byline = node('div', '', 'geld-provider-review__byline');
    byline.append(node('strong', comment.author.login));
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
        button.addEventListener('click', () => {
          button.disabled = true;
          void action.activate().then((activated) => {
            if (activated) options.onActionComplete?.();
            else button.title = 'The original comment controls are unavailable';
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
    const required = options.approvalsRequired;
    const left = options.approvalsLeft;
    const tally = typeof required === 'number' && typeof left === 'number' && Number.isSafeInteger(required) && Number.isSafeInteger(left) && required > 0 && left >= 0 && left <= required
      ? `${required - left}/${required} required approvals`
      : countLabel(approvals, 'approval');
    const section = disclosure('reviewers', `Reviews · ${reviewers === undefined ? 'Unavailable' : `${tally}${changes === 0 ? '' : ` · ${countLabel(changes, 'change request')}`}`}`, false);
    if (reviewers === undefined || reviewers.length === 0) {
      section.append(node('p', reviewers === undefined ? 'Review standings could not be read.' : 'No reviewer standings.'));
      return section;
    }
    const list = node('ul');
    for (const reviewer of reviewers) {
      const row = node('li', '', 'geld-provider-review__standing');
      row.dataset.state = reviewer.state;
      const url = reviewer.url === undefined ? null : safeUrl(reviewer.url, input.subject.origin);
      row.append(url === null ? node('span', reviewer.author.login) : link(reviewer.author.login, url, reviewer.anchor ?? ''));
      if (reviewer.author.automated === true) row.append(node('span', 'Automated account', 'geld-provider-review__muted'));
      row.append(node('span', STANDING[reviewer.state]));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function checksSection(): HTMLElement {
    const checks = input.checks;
    const current = checks?.filter((check) => currentCheck(check, input.subject.headSha)) ?? [];
    const counts = new Map<string, number>();
    for (const check of current) counts.set(checkState(check), (counts.get(checkState(check)) ?? 0) + 1);
    const tally = [...counts].map(([state, count]) => `${count} ${state.toLowerCase()}`).join(' · ');
    const section = disclosure('checks', `CI checks · ${checks === undefined ? 'Unavailable' : current.length === 0 ? 'None on this commit' : tally}`, false);
    if (checks === undefined || checks.length === 0) section.append(node('p', checks === undefined ? 'CI checks could not be read.' : 'No CI checks reported.'));
    const list = node('ul');
    for (const check of checks ?? []) {
      const state = checkState(check);
      const row = node('li', '', 'geld-provider-review__check');
      row.dataset.state = currentCheck(check, input.subject.headSha) ? state.toLowerCase() : 'previous';
      const url = check.detailsUrl === undefined ? null : safeUrl(check.detailsUrl);
      row.append(url === null ? node('span', check.name) : link(check.name, url, '', true));
      row.append(node('span', currentCheck(check, input.subject.headSha) ? state : `Earlier commit · ${state}`));
      if (check.description !== undefined && check.description !== '') row.append(node('span', check.description, 'geld-provider-review__muted'));
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

  function itemSection(item: ReviewItem, comments: ReadonlyMap<string, ProviderReviewComment>): HTMLElement {
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
      fix.append(node('strong', item.fix.source === 'ai' ? 'Suggested fix · AI' : 'Suggested fix'), node('pre', item.fix.text));
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
    const events = options.events ?? [];
    const pushes = events.filter((event) => event.kind === 'push' && Number.isFinite(Date.parse(event.createdAt)) && safeUrl(event.url, input.subject.origin) !== null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    interface HistoryEntry { readonly at: number; readonly key: string; readonly render: () => HTMLElement }
    const entries: HistoryEntry[] = [
      ...items.map((item) => ({ at: Math.min(...item.sources.map((source) => Date.parse(comments.get(source.anchor)?.createdAt ?? '')).filter(Number.isFinite)), key: `item:${item.id}`, render: () => itemSection(item, comments) })),
      ...ordinary.map((comment) => ({ at: Date.parse(comment.updatedAt ?? comment.createdAt), key: `comment:${comment.id}`, render: () => sourceComment(comment) })),
      ...events.filter((event) => !pushes.includes(event)).map((event) => ({ at: Date.parse(event.createdAt), key: `event:${event.id}`, render: () => eventRow(event) })),
    ];
    entries.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
    if (pushes.length === 0) {
      if (entries.length === 0) return [];
      const section = disclosure('history:unpartitioned', 'Conversation history · push boundaries unavailable', true);
      section.dataset.geldReviewHistory = '';
      for (const entry of entries) section.append(entry.render());
      return [section];
    }
    const boundaries: Array<{ readonly at: number; readonly pushes: ProviderReviewPanelEvent[] }> = [];
    for (const push of pushes) {
      const at = Date.parse(push.createdAt);
      const last = boundaries.at(-1);
      if (last?.at === at) last.pushes.push(push);
      else boundaries.push({ at, pushes: [push] });
    }
    const sections: HTMLElement[] = [];
    const before = entries.filter((entry) => Number.isFinite(entry.at) && entry.at < (boundaries[0]?.at ?? Infinity));
    if (before.length > 0) {
      const section = disclosure('history:before', 'Before the first recorded push', false);
      for (const entry of before) section.append(entry.render());
      sections.push(section);
    }
    for (const [index, boundary] of boundaries.entries()) {
      const next = boundaries[index + 1]?.at ?? Infinity;
      const section = disclosure(`history:push:${boundary.pushes.map((push) => push.id).join(':')}`, `Push round ${index + 1}${index === boundaries.length - 1 ? ' · Latest recorded push' : ''}`, index === boundaries.length - 1);
      section.dataset.geldReviewRound = boundary.pushes.map((push) => push.id).join(':');
      for (const push of boundary.pushes) section.append(eventRow(push));
      const members = entries.filter((entry) => Number.isFinite(entry.at) && entry.at >= boundary.at && entry.at < next);
      for (const entry of members) section.append(entry.render());
      if (members.length === 0) section.append(node('p', 'No conversation recorded after this push.', 'geld-provider-review__muted'));
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

  function digestText(): string {
    const lines = ['# Geld review digest', providerReviewUrl(input.subject), ''];
    if ((options.complete ?? input.complete) === false || (options.unavailable?.length ?? 0) > 0) lines.push('Some review data is unavailable.', '');
    for (const reviewer of input.reviewers ?? []) lines.push(`- ${reviewer.author.login}: ${STANDING[reviewer.state]}`);
    const summary = options.ai?.enabled === true && options.ai.state.key === identity ? options.ai.state.summary : undefined;
    if (summary !== undefined) lines.push('', `AI summary: ${summary.tldr}`, '');
    for (const bot of bots) lines.push(`- ${botById(bot.id)?.title ?? bot.id}: ${verdictLabel(bot)}`);
    for (const check of input.checks ?? []) {
      const url = check.detailsUrl === undefined ? null : safeUrl(check.detailsUrl);
      lines.push(`- CI: ${check.name}: ${checkState(check)}${currentCheck(check, input.subject.headSha) ? '' : ' (earlier commit)'}${url === null ? '' : ` ${url}`}`);
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
    for (const event of options.events ?? []) {
      const url = safeUrl(event.url, input.subject.origin);
      lines.push(`- ${event.author.login}: ${event.body}${url === null ? '' : ` ${url}`}`);
    }
    return lines.join('\n');
  }

  function render(): void {
    if (destroyed) return;
    const focused = doc.activeElement;
    const reviewedFocus = focused !== null && panel.contains(focused) ? focused.getAttribute('data-geld-local-reviewed') ?? focused.getAttribute('data-geld-local-review-focus') : null;
    nativeTimes.clear();
    for (const time of doc.querySelectorAll<HTMLTimeElement>('time[datetime]')) {
      if (time.closest('[data-geld-ui]') !== null) continue;
      const at = Date.parse(time.dateTime);
      if (Number.isFinite(at) && time.textContent?.trim()) nativeTimes.set(at, time.textContent.trim());
    }
    const ai = options.ai;
    const signature = JSON.stringify([input, options.comments, options.events, options.complete, options.unavailable, options.approvalsRequired, options.approvalsLeft, options.updating, options.version, options.suggestedFixes, options.reviewGrouping, options.localReviewed === undefined ? null : [[...options.localReviewed.ids], [...options.localReviewed.pending], options.localReviewed.error], ai === undefined ? null : [ai.enabled, ai.state.kind, ai.state.key, ai.state.stale, ai.state.summary, ai.state.ranAt, ai.state.error, [...ai.state.pending]], options.identifyReviewer?.choices, nativeTimes.size]);
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
    if (options.reviewGrouping !== 'batch' && (options.events?.length ?? 0) > 0) {
      const section = disclosure('activity', `Activity · ${options.events?.length ?? 0}`, false);
      for (const event of options.events ?? []) {
        section.append(eventRow(event));
      }
      children.push(section);
    }
    panel.replaceChildren(...children);
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
      panel.remove();
    },
  };
}
