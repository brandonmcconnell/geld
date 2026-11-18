import { allHosts } from '@geld/core';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { GitHubAccount } from '../../src/lib/account';
import { accountItem } from '../../src/lib/account';
import { formatDiagnostics, readDiagnostics } from '../../src/lib/diagnostics';
import { installErrorCapture } from '../../src/lib/error-capture';
import type { ContextChoice, ContextKey, FeedbackContext, FeedbackDraft } from '../../src/lib/feedback';
import { draftFromParams, draftIsEmpty, EMPTY_DRAFT, FEEDBACK_KINDS, FEEDBACK_REPO, feedbackIssue, parseDraft, reposNamedIn, rollbackDraft } from '../../src/lib/feedback';
import type { FeedbackOpenMessage, FeedbackSubmitMessage } from '../../src/lib/messages';
import { isFeedbackOpenMessage, isFeedbackSubmitResponse } from '../../src/lib/messages';
import { collectTabPerf } from '../../src/lib/perf-report';
import { repoVisibility } from '../../src/lib/repo-visibility';
import { settingsItem } from '../../src/lib/storage';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { polyfillCornerShape } from '../../src/ui/corner-shape';
import { describeBrowser, whereWords } from '../../src/ui/feedback-link';
import { requireElement } from '../../src/ui/switch';
import { renderIssueMarkdown } from '../../src/ui/issue-markdown';
import { providerLabel } from '../../src/lib/git-provider';
import { svgFromString } from '../../src/github/dom';
import { ICON_ALERT } from '../../src/github/ui/icons';

installErrorCapture('options');
polyfillCornerShape();

/** What the reader has written so far, kept until it is sent so a closed tab or a sign-in loses nothing. */
const draftItem = storage.defineItem<unknown>('local:feedbackDraft', { fallback: null });

const form = requireElement('form', HTMLFormElement);
const kinds = requireElement('kinds', HTMLDivElement);
const titleInput = requireElement('title', HTMLInputElement);
const textInput = requireElement('text', HTMLTextAreaElement);
const choicesHost = requireElement('choices', HTMLDivElement);
const previewTitle = requireElement('preview-title', HTMLParagraphElement);
const previewBody = requireElement('preview-body', HTMLPreElement);
const previewRendered = requireElement('preview-rendered', HTMLDivElement);
const previewMode = requireElement('preview-mode', HTMLButtonElement);
const consent = requireElement('consent', HTMLInputElement);
const consentWords = requireElement('consent-words', HTMLSpanElement);
const status = requireElement('status', HTMLSpanElement);
const send = requireElement('send', HTMLButtonElement);
const sendTip = requireElement('send-tip', HTMLSpanElement);
const sent = requireElement('sent', HTMLElement);
const sentLink = requireElement('sent-link', HTMLAnchorElement);
const again = requireElement('again', HTMLButtonElement);

mountAccountWidget(requireElement('account', HTMLDivElement), { variant: 'full', promptHost: requireElement('account-prompt', HTMLDivElement) });

const query = new URLSearchParams(location.search);
let draft: FeedbackDraft = EMPTY_DRAFT;
let account: GitHubAccount | null = null;
let sending = false;
let showMarkdown = false;
let previewFrame: number | null = null;
const EMPTY_CONTEXT: FeedbackContext = { environment: null, where: null, page: null, diagnostics: null, provider: null };
let context: FeedbackContext = EMPTY_CONTEXT;
/** Whether every repository the diagnostics name is public, as a stranger sees it (`repoVisibility`). */
let everyRepoPublic = false;
let loadingContext = true;
let contextLoad = 0;
const choice: Record<ContextKey, boolean> = { environment: true, where: true, diagnostics: false };
/** Report with diagnostics asked for them outright, so they start ticked whatever the repositories. */
let diagnosticsAsked = query.get('diagnostics') === '1';
const tabParam = Number(query.get('tab') ?? NaN);
let openingTab: number | null = Number.isInteger(tabParam) && tabParam >= 0 ? tabParam : null;

function say(message: string, tone: 'success' | 'error' | null = null): void {
  status.textContent = message;
  if (tone === null) delete status.dataset.tone;
  else status.dataset.tone = tone;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: ReadonlyArray<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function renderKinds(): void {
  kinds.replaceChildren(
    ...FEEDBACK_KINDS.map((kind) => {
      const input = el('input', 'feedback__kind-input');
      input.type = 'radio';
      input.name = 'kind';
      input.value = kind.id;
      input.checked = draft.kind === kind.id;
      input.addEventListener('change', () => {
        if (input.checked) update({ kind: kind.id });
      });
      return el('label', 'feedback__kind', [input, el('span', '', [kind.label])]);
    }),
  );
}

const CHOICE_LABELS: Readonly<Record<ContextKey, string>> = {
  environment: 'Geld and browser version',
  where: 'Page type',
  diagnostics: 'Diagnostics',
};

function noteFor(key: ContextKey): string | null {
  if (key !== 'diagnostics') return null;
  return everyRepoPublic
    ? 'Diff fetches and timings for this session, and the page address. Every repository in it is public, so it is included by default. No page content or tokens.'
    : 'Diff fetches and timings for this session, and the page address. Some repositories in it may be private, so it is left out by default. No page content or tokens.';
}

function shown(key: ContextKey): ReadonlyArray<Node | string> | null {
  const value = context[key];
  if (value === null) return null;
  if (key !== 'diagnostics') return [value];
  const lines = value.split('\n').length;
  // The alert octicon rather than the ⚠ character, which some systems draw as a colour emoji.
  return [`${lines} ${lines === 1 ? 'line' : 'lines'}, `, el('span', 'feedback__warning', [svgFromString(ICON_ALERT), 'includes the URL of every open Git tab'])];
}

function renderChoices(): void {
  const keys: readonly ContextKey[] = ['environment', 'where', 'diagnostics'];
  choicesHost.replaceChildren(
    ...keys.flatMap((key) => {
      const value = shown(key);
      if (value === null) return [];
      const input = el('input', 'geld-checkbox');
      input.type = 'checkbox';
      input.checked = choice[key];
      input.addEventListener('change', () => {
        choice[key] = input.checked;
        renderPreview();
        renderSend();
      });
      const words = el('span', 'feedback__choice-words', [el('span', 'feedback__choice-label', [CHOICE_LABELS[key]]), el('span', 'feedback__choice-value', value)]);
      const note = noteFor(key);
      if (note !== null) words.append(el('span', 'geld-help', [note]));
      return [el('label', 'feedback__choice', [input, words])];
    }),
  );
}

function currentChoice(): ContextChoice {
  return { ...choice };
}

function renderPreview(): void {
  if (previewFrame !== null) return;
  // Coalesced to a frame: typing re-renders the whole body, diagnostics included.
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    const issue = feedbackIssue(draft, context, currentChoice());
    const noTitle = draft.title.trim() === '';
    const noText = draft.text.trim() === '';
    previewTitle.replaceChildren(noTitle ? `${issue.title} ` : issue.title);
    if (noTitle) previewTitle.append(el('span', 'feedback__placeholder', ['Title will appear here']));
    previewRendered.hidden = showMarkdown;
    previewBody.hidden = !showMarkdown;
    previewMode.textContent = showMarkdown ? 'Show preview' : 'Show markdown';
    const missing = noText ? [el('span', 'feedback__placeholder', ['Details will appear here'])] : [];
    if (showMarkdown) {
      previewBody.replaceChildren(...missing, noText ? `\n\n${issue.body}` : issue.body);
      previewRendered.replaceChildren();
    } else {
      previewRendered.replaceChildren(...missing.map((node) => el('p', '', [node])), renderIssueMarkdown(issue.body));
      previewBody.replaceChildren();
    }
  });
}

previewMode.addEventListener('click', () => {
  showMarkdown = !showMarkdown;
  renderPreview();
});

function renderAccount(): void {
  const ready = account !== null && account.auth === 'app';
  // Locked while sending: the request already holds the words, so a correction typed now would be lost.
  titleInput.readOnly = sending;
  textInput.readOnly = sending;
  for (const radio of kinds.querySelectorAll('input')) radio.disabled = sending;
  consent.disabled = !ready || sending || loadingContext;
  if (!ready) consent.checked = false;
  consentWords.textContent = ready
    ? `I understand this opens a public issue on ${FEEDBACK_REPO} from my GitHub account, @${account?.login ?? ''}, with what I wrote and what I ticked above.`
    : account === null
      ? 'Sign in with GitHub above to send this. Feedback is opened as a public issue from your own account, and signing in also syncs your settings to a secret gist.'
      : 'Sign in with GitHub again above to send this.';
  renderSend();
}

/** What still stands between the draft and sending it, in the order the reader meets it; `null` when nothing does. */
function blocker(): string | null {
  if (draft.title.trim() === '') return 'A title is required.';
  if (draft.text.trim() === '') return 'Details are required.';
  if (account === null) return 'Sign in with GitHub to send it.';
  if (account.auth !== 'app') return 'Sign in with GitHub again to send it.';
  if (loadingContext) return 'Geld is still reading the page. Try again in a moment.';
  if (!consent.checked) return 'Tick the box above to send it.';
  const over = feedbackIssue(draft, context, currentChoice()).overBy;
  if (over > 0) return `That is ${over.toLocaleString()} characters more than one GitHub issue can hold. Shorten the details to send it.`;
  return null;
}

let tipTimer: ReturnType<typeof setTimeout> | null = null;

function hideTip(): void {
  if (tipTimer !== null) clearTimeout(tipTimer);
  tipTimer = null;
  sendTip.hidden = true;
  sendTip.textContent = '';
}

function showTip(message: string): void {
  sendTip.textContent = message;
  sendTip.hidden = false;
  if (tipTimer !== null) clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, 4000);
}

/** Looks disabled until the draft can go, but stays clickable so a click can say what is missing. */
function renderSend(): void {
  send.disabled = sending;
  send.setAttribute('aria-disabled', String(sending || blocker() !== null));
  send.textContent = sending ? 'Sending…' : 'Send feedback';
  if (!sendTip.hidden && blocker() === null) hideTip();
}

function update(patch: Partial<FeedbackDraft>): void {
  draft = { ...draft, ...patch };
  renderPreview();
  renderSend();
  // Saved on every edit, not after a pause: a tab closed during the pause would lose its last words.
  void draftItem.setValue(draftIsEmpty(draft) ? null : draft);
}

function sameDraft(a: FeedbackDraft | null, b: FeedbackDraft): boolean {
  return a !== null && a.kind === b.kind && a.title === b.title && a.text === b.text;
}

titleInput.addEventListener('input', () => update({ title: titleInput.value }));
textInput.addEventListener('input', () => update({ text: textInput.value }));
consent.addEventListener('change', renderSend);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submit();
});

async function submit(): Promise<void> {
  if (sending) return;
  const blocked = blocker();
  if (blocked !== null) {
    showTip(blocked);
    return;
  }
  hideTip();
  const issue = feedbackIssue(draft, context, currentChoice());
  const sentDraft = draft;
  sending = true;
  renderAccount();
  say('Opening the issue on GitHub…');
  const message: FeedbackSubmitMessage = { type: 'geld:feedback-submit', title: issue.title, body: issue.body };
  let answer: unknown;
  try {
    answer = await browser.runtime.sendMessage(message);
  } catch (error) {
    answer = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  sending = false;
  if (isFeedbackSubmitResponse(answer) && answer.ok) {
    // Another feedback tab may have saved different words since: only the draft that was sent is cleared.
    if (sameDraft(parseDraft(await draftItem.getValue()), sentDraft)) await draftItem.setValue(null);
    sentLink.href = answer.url;
    sentLink.textContent = `Open issue #${answer.number}`;
    form.hidden = true;
    sent.hidden = false;
    say('');
    sentLink.focus();
    renderAccount();
    return;
  }
  say(isFeedbackSubmitResponse(answer) && !answer.ok ? answer.message : 'Geld could not send it. Your draft is kept.', 'error');
  renderAccount();
}

function startOver(): void {
  draft = EMPTY_DRAFT;
  titleInput.value = '';
  textInput.value = '';
  consent.checked = false;
  sent.hidden = true;
  form.hidden = false;
  renderKinds();
  renderPreview();
  renderAccount();
  titleInput.focus();
}

again.addEventListener('click', startOver);

/** Another Feedback link was followed while this page is open: come to the front with that context instead of a second tab. */
async function reopen(opening: FeedbackOpenMessage): Promise<void> {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) await browser.tabs.update(tab.id, { active: true });
  if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
  if (!sent.hidden) startOver();
  if (sending) return;
  // Opened from no GitHub tab (the options page, a non-GitHub page): the page it was opened from before says nothing now.
  openingTab = opening.tabId ?? null;
  if (opening.diagnostics === true) diagnosticsAsked = true;
  const opened = withOpening(draft, opening.rollback?.from ?? null, opening.rollback?.to ?? null, opening.draft ?? null);
  if (opened !== draft) {
    update(opened);
    titleInput.value = draft.title;
    textInput.value = draft.text;
    renderKinds();
    if (opening.rollback !== undefined) textInput.focus();
    else focusTitleEnd();
  }
  // The page may be another one now, perhaps a private repository's: the diagnostics and the consent are asked for afresh.
  choice.diagnostics = false;
  consent.checked = false;
  renderAccount();
  await loadContext();
}

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isFeedbackOpenMessage(message)) return undefined;
  sendResponse(true);
  void reopen(message);
  return undefined;
});

async function pageOfTab(hosts: readonly string[]): Promise<URL | null> {
  if (openingTab === null) return null;
  try {
    const tab = await browser.tabs.get(openingTab);
    if (tab.url === undefined) return null;
    const url = new URL(tab.url);
    return hosts.includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

const PERF_WAIT_MS = 2000;
const UNREAD_CONTEXT: FeedbackContext & { readonly everyRepoPublic: boolean } = { ...EMPTY_CONTEXT, everyRepoPublic: false };
/** More repositories than this and the report is treated as holding a private one, rather than asking about each. */
const MAX_VISIBILITY_CHECKS = 12;

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function gatherContext(): Promise<FeedbackContext & { readonly everyRepoPublic: boolean }> {
  const manifest = browser.runtime.getManifest();
  const settings = await settingsItem.getValue();
  const hosts = allHosts(settings);
  const named = manifest.version_name !== undefined && manifest.version_name !== manifest.version ? ` (${manifest.version_name})` : '';
  const browserWords = describeBrowser(navigator.userAgent, navigator.platform);
  const environment = [`${manifest.version}${named}`, browserWords].filter((part) => part !== '').join(' · ');
  // A frozen GitHub tab answers the timings request only when it wakes: the report goes without them after a short wait.
  const [page, events, perf] = await Promise.all([pageOfTab(hosts), readDiagnostics(), within(collectTabPerf(hosts), PERF_WAIT_MS, [])]);
  const diagnostics = [formatDiagnostics(events, manifest.version), ...perf].join('\n\n');
  const repos = reposNamedIn(diagnostics);
  const everyPublic =
    repos.length <= MAX_VISIBILITY_CHECKS && (await Promise.all(repos.map((address) => repoVisibility(new URL(address))))).every((seen) => seen === 'public');
  return {
    everyRepoPublic: everyPublic,
    environment,
    where: page === null ? null : whereWords(page),
    // The path alone: a public repository's search can still hold private words in its query.
    page: page === null ? null : `${page.origin}${page.pathname}`,
    provider: page === null ? null : providerLabel(page),
    diagnostics,
  };
}

/** The draft the page was opened with (a rollback's, or one its address names), unless the reader already has words of their own. */
function withOpening(current: FeedbackDraft, from: string | null, to: string | null, started: FeedbackDraft | null): FeedbackDraft {
  if (!draftIsEmpty(current)) return current;
  if (from !== null && to !== null) return rollbackDraft(from, to);
  return started ?? current;
}

/** A title started for the reader ends where they type ("Add support for "), so the caret goes there. */
function focusTitleEnd(): void {
  titleInput.focus();
  titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
}

async function start(): Promise<void> {
  const [stored, signedIn] = await Promise.all([draftItem.getValue(), accountItem.getValue()]);
  const saved = parseDraft(stored) ?? EMPTY_DRAFT;
  const started = draftFromParams(query);
  draft = withOpening(saved, query.get('rollback-from'), query.get('rollback-to'), started);
  const fromAddress = started !== null && draft === started;
  account = signedIn;
  titleInput.value = draft.title;
  textInput.value = draft.text;
  renderKinds();
  renderPreview();
  renderAccount();
  accountItem.watch((value) => {
    account = value;
    renderAccount();
  });
  if (fromAddress) focusTitleEnd();
  else (draft.title === '' ? titleInput : textInput).focus();
  await loadContext();
}

/** The page's context, with the diagnostics ticked by default only when every repository they name is public. */
async function loadContext(): Promise<void> {
  // Consent waits for the context: what it agrees to may still change while the visibility check runs (up to 5 s).
  const load = ++contextLoad;
  loadingContext = true;
  consent.checked = false;
  // The choices about to be replaced cannot be changed meanwhile: the load would overwrite them.
  for (const input of choicesHost.querySelectorAll('input')) input.disabled = true;
  renderAccount();
  // Nothing on this page may keep the form waiting: a context that cannot be read is an empty one.
  const { everyRepoPublic: everyPublic, ...gathered } = await gatherContext().catch(() => UNREAD_CONTEXT);
  // A later opening started meanwhile: its page is the one shown, whichever answers first.
  if (load !== contextLoad) return;
  context = gathered;
  everyRepoPublic = everyPublic;
  choice.diagnostics = everyPublic || diagnosticsAsked;
  loadingContext = false;
  renderChoices();
  renderPreview();
  renderAccount();
}

void start();

