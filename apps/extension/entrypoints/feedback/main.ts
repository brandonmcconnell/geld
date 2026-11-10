import { allHosts } from '@geld/core';
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { GitHubAccount } from '../../src/lib/account';
import { accountItem } from '../../src/lib/account';
import { formatDiagnostics, readDiagnostics } from '../../src/lib/diagnostics';
import { installErrorCapture } from '../../src/lib/error-capture';
import type { ContextChoice, ContextKey, FeedbackContext, FeedbackDraft } from '../../src/lib/feedback';
import { draftIsEmpty, EMPTY_DRAFT, FEEDBACK_KINDS, FEEDBACK_REPO, feedbackIssue, parseDraft } from '../../src/lib/feedback';
import type { FeedbackSubmitMessage } from '../../src/lib/messages';
import { isFeedbackSubmitResponse } from '../../src/lib/messages';
import { collectTabPerf } from '../../src/lib/perf-report';
import { settingsItem } from '../../src/lib/storage';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { polyfillCornerShape } from '../../src/ui/corner-shape';
import { describeBrowser, whereWords } from '../../src/ui/feedback-link';
import { requireElement } from '../../src/ui/switch';

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
const consent = requireElement('consent', HTMLInputElement);
const consentWords = requireElement('consent-words', HTMLSpanElement);
const status = requireElement('status', HTMLSpanElement);
const send = requireElement('send', HTMLButtonElement);
const sent = requireElement('sent', HTMLElement);
const sentLink = requireElement('sent-link', HTMLAnchorElement);
const again = requireElement('again', HTMLButtonElement);

mountAccountWidget(requireElement('account', HTMLDivElement), { variant: 'full', promptHost: requireElement('account-prompt', HTMLDivElement) });

const query = new URLSearchParams(location.search);
let draft: FeedbackDraft = EMPTY_DRAFT;
let account: GitHubAccount | null = null;
let sending = false;
let context: FeedbackContext = { environment: null, where: null, page: null, diagnostics: null };
const choice: Record<ContextKey, boolean> = { environment: true, where: true, page: false, diagnostics: query.get('diagnostics') === '1' };

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

const CHOICE_COPY: Readonly<Record<ContextKey, { readonly label: string; readonly note?: string }>> = {
  environment: { label: 'Geld and browser version' },
  where: { label: 'The kind of page' },
  page: { label: 'The page address', note: 'The issue is public. Leave this off for a private repository.' },
  diagnostics: { label: 'Diagnostics', note: 'Diff fetches and timings for this session, naming pull requests by number. No page content or tokens.' },
};

function shown(key: ContextKey): string | null {
  const value = context[key];
  if (value === null) return null;
  if (key !== 'diagnostics') return value;
  const lines = value.split('\n').length;
  return `${lines} ${lines === 1 ? 'line' : 'lines'}, shown in the preview`;
}

function renderChoices(): void {
  const keys: readonly ContextKey[] = ['environment', 'where', 'page', 'diagnostics'];
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
      });
      const copy = CHOICE_COPY[key];
      const words = el('span', 'feedback__choice-words', [el('span', 'feedback__choice-label', [copy.label]), el('span', 'feedback__choice-value', [value])]);
      if (copy.note !== undefined) words.append(el('span', 'geld-help', [copy.note]));
      return [el('label', 'feedback__choice', [input, words])];
    }),
  );
}

function currentChoice(): ContextChoice {
  return { ...choice };
}

function renderPreview(): void {
  const issue = feedbackIssue(
    { ...draft, title: draft.title.trim() === '' ? '(title)' : draft.title, text: draft.text.trim() === '' ? '(details)' : draft.text },
    context,
    currentChoice(),
  );
  previewTitle.textContent = issue.title;
  previewBody.textContent = issue.body;
}

function renderAccount(): void {
  const ready = account !== null && account.auth === 'app';
  consent.disabled = !ready || sending;
  if (!ready) consent.checked = false;
  consentWords.textContent = ready
    ? `I understand this opens a public issue on ${FEEDBACK_REPO} from my GitHub account, @${account?.login ?? ''}, with what I wrote and what I ticked above.`
    : account === null
      ? 'Sign in with GitHub above to send this. Feedback is opened as a public issue from your own account, and signing in also syncs your settings to a secret gist.'
      : 'Sign in with GitHub again above to send this.';
  renderSend();
}

function renderSend(): void {
  send.disabled = sending || account === null || account.auth !== 'app' || !consent.checked;
  send.textContent = sending ? 'Sending…' : 'Send feedback';
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function update(patch: Partial<FeedbackDraft>): void {
  draft = { ...draft, ...patch };
  renderPreview();
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void draftItem.setValue(draftIsEmpty(draft) ? null : draft);
  }, 300);
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
  if (draft.title.trim() === '') {
    say('Add a title first.', 'error');
    titleInput.focus();
    return;
  }
  if (draft.text.trim() === '') {
    say('Add some details first.', 'error');
    textInput.focus();
    return;
  }
  if (!consent.checked) {
    say('Tick the box above to send it.', 'error');
    return;
  }
  const issue = feedbackIssue(draft, context, currentChoice());
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
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    await draftItem.setValue(null);
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

again.addEventListener('click', () => {
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
});

async function pageOfTab(hosts: readonly string[]): Promise<URL | null> {
  const id = Number(query.get('tab'));
  if (!Number.isInteger(id) || id < 0) return null;
  try {
    const tab = await browser.tabs.get(id);
    if (tab.url === undefined) return null;
    const url = new URL(tab.url);
    return hosts.includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

async function gatherContext(): Promise<FeedbackContext> {
  const manifest = browser.runtime.getManifest();
  const settings = await settingsItem.getValue();
  const hosts = allHosts(settings);
  const named = manifest.version_name !== undefined && manifest.version_name !== manifest.version ? ` (${manifest.version_name})` : '';
  const browserWords = describeBrowser(navigator.userAgent, navigator.platform);
  const environment = [`${manifest.version}${named}`, browserWords].filter((part) => part !== '').join(' · ');
  const [page, events, perf] = await Promise.all([pageOfTab(hosts), readDiagnostics(), collectTabPerf(hosts)]);
  return {
    environment,
    where: page === null ? null : whereWords(page),
    page: page === null ? null : `${page.origin}${page.pathname}${page.search}`,
    diagnostics: [formatDiagnostics(events, manifest.version), ...perf].join('\n\n'),
  };
}

async function start(): Promise<void> {
  const [stored, signedIn] = await Promise.all([draftItem.getValue(), accountItem.getValue()]);
  draft = parseDraft(stored) ?? EMPTY_DRAFT;
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
  (draft.title === '' ? titleInput : textInput).focus();
  context = await gatherContext();
  renderChoices();
  renderPreview();
}

void start();

