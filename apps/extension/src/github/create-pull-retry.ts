import { browser } from 'wxt/browser';
import type { CreatePullOutcome, PullAttempt } from '../lib/create-pull';
import { CREATE_FAILED_PREFIX, ghCommand, isRetryableFailure, pullAttemptFrom } from '../lib/create-pull';
import type { ApiSignedInMessage, CreatePullMessage } from '../lib/messages';
import { isCreatePullOutcome } from '../lib/messages';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { brandMark } from './review/brand';
import { ICON_CHECK, ICON_COPY, ICON_SPINNER } from './ui/icons';
import { attachTooltipMessage } from './ui/tooltip';

/**
 * GitHub's compare form refuses a pull request with a flash ("Pull request creation failed. Validation failed: was
 * submitted too quickly") and renders the form again with the title and body kept. "Try again" sends the form itself
 * again through the reader's session, once it is old enough for GitHub's timing check. "Trigger via API", for a reader
 * signed in to Geld with the GitHub App, makes the request `gh pr create` makes with that App's token, which no form
 * check sees. The `gh` command shows for everyone. Nothing runs until the reader asks, so it never races GitHub.
 */

const ROOT_CLASS = 'geld-pull-retry';
const RETRY_TOOLTIP = "Send the form again once GitHub's timing check allows it";
const API_TOOLTIP = "Geld opens it through GitHub's API, as the `gh` CLI does";
/** GitHub's forms carry the moment they were rendered, and a submission sooner than this after it is refused as too quick. */
const MIN_FORM_AGE_MS = 5000;
const MAX_WAIT_MS = 10_000;

export interface CreateFailure {
  readonly flash: HTMLElement;
  readonly alert: HTMLElement;
  readonly message: string;
}

/** GitHub's words alone: Geld's buttons stand inside the flash, ahead of the message when no alert element wraps it. */
function gitHubText(element: Element): string {
  const copy = element.cloneNode(true);
  if (copy instanceof Element) for (const own of copy.querySelectorAll(`[${OWN_UI_ATTRIBUTE}]`)) own.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function findCreateFailure(root: ParentNode = document): CreateFailure | null {
  for (const flash of root.querySelectorAll<HTMLElement>('.flash-error')) {
    const alert = flash.querySelector<HTMLElement>('.js-flash-alert, [role="alert"]') ?? flash;
    const message = gitHubText(alert);
    if (message.startsWith(CREATE_FAILED_PREFIX)) return { flash, alert, message: message.slice(CREATE_FAILED_PREFIX.length).trim() };
  }
  return null;
}

/** The form's own action: `form.action` is shadowed by a field named `action`. */
function actionOf(form: HTMLFormElement, base: string = location.href): URL {
  return new URL(form.getAttribute('action') ?? '', base);
}

export function findCreateForm(root: ParentNode = document): HTMLFormElement | null {
  for (const form of root.querySelectorAll('form')) {
    if (/\/pull\/create\/?$/.test(actionOf(form).pathname)) return form;
  }
  return null;
}

/** The button GitHub's form would be sent with: its name and value say whether it opens a draft. */
function submitterOf(form: HTMLFormElement): HTMLButtonElement | HTMLInputElement | null {
  const submits = [...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"], button:not([type])')].filter((button) => !button.disabled);
  return submits.find((button) => button.classList.contains('btn-primary')) ?? submits[0] ?? null;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : '';
}

function formEntries(form: HTMLFormElement): URLSearchParams {
  const submitter = submitterOf(form);
  const data = submitter === null ? new FormData(form) : new FormData(form, submitter);
  const params = new URLSearchParams();
  for (const [name, value] of data) if (typeof value === 'string') params.append(name, value);
  return params;
}

export function attemptFromPage(form: HTMLFormElement, pageUrl: URL = new URL(location.href)): PullAttempt | null {
  const entries = formEntries(form);
  const submitter = submitterOf(form);
  const draftValue = entries.get('draft') ?? '';
  const label = submitter instanceof HTMLInputElement ? submitter.value : (submitter?.textContent ?? '');
  const draft = /^(on|true|1)$/i.test(draftValue) || /\bdraft\b/i.test(label);
  return pullAttemptFrom({
    pagePath: pageUrl.pathname,
    queries: [actionOf(form, pageUrl.href).searchParams, pageUrl.searchParams],
    title: fieldValue(form, 'pull_request[title]'),
    body: fieldValue(form, 'pull_request[body]'),
    draft,
  });
}

/** How long to hold the form back so GitHub no longer finds it too quick: its `timestamp` field, else the page's age. */
export function waitBeforeResubmit(form: HTMLFormElement, now = Date.now(), pageAge = performance.now()): number {
  const stamp = Number(fieldValue(form, 'timestamp'));
  const age = Number.isFinite(stamp) && stamp > 0 ? now - (stamp > 1e12 ? stamp : stamp * 1000) : pageAge;
  return Math.min(MAX_WAIT_MS, Math.max(0, MIN_FORM_AGE_MS - age));
}

type Outcome = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

const PULL_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/;

/** Where GitHub's answer landed: Chrome keeps the redirect's URL, Firefox's page fetch loses it, so the page's own canonical link says. */
export function createdPullUrl(answerUrl: string, html: string, base: string): string | null {
  const candidates = [answerUrl];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const selector of ['link[rel="canonical"]', 'meta[property="og:url"]']) {
    const element = doc.querySelector(selector);
    candidates.push(element?.getAttribute('href') ?? element?.getAttribute('content') ?? '');
  }
  for (const candidate of candidates) {
    if (candidate === '') continue;
    const url = new URL(candidate, base);
    if (PULL_PATH.test(url.pathname)) return url.href;
  }
  return null;
}

/** A send that did not go: the controls went while it waited (a navigation, Geld turned off), or the reader declined. */
const CANCELLED: Outcome = { ok: false, message: 'Cancelled.' };

async function resubmit(form: HTMLFormElement, signal: AbortSignal): Promise<Outcome> {
  const wait = waitBeforeResubmit(form);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  if (signal.aborted || !form.isConnected) return CANCELLED;
  const action = actionOf(form);
  try {
    const answer = await pageFetch(action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: formEntries(form).toString(),
    });
    const html = await answer.text();
    const created = createdPullUrl(answer.url, html, action.href);
    if (created !== null) return { ok: true, url: created };
    const refused = findCreateFailure(new DOMParser().parseFromString(html, 'text/html'));
    return { ok: false, message: refused?.message ?? (answer.ok ? 'GitHub did not open it.' : `GitHub answered ${answer.status}.`) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Who GitHub says is signed in on this page: the API request is made only as that same account. */
function viewer(): string {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? '';
}

/** Sidebar choices the form would send that the API's create request has no field for. */
const SIDEBAR_FIELDS: readonly { readonly pattern: RegExp; readonly words: string }[] = [
  { pattern: /reviewer/i, words: 'Reviewers' },
  { pattern: /assignee/i, words: 'Assignees' },
  { pattern: /label/i, words: 'Labels' },
  { pattern: /milestone/i, words: 'A milestone' },
  { pattern: /project/i, words: 'Projects' },
];

export function sidebarChoices(form: HTMLFormElement): readonly string[] {
  const entries = [...formEntries(form)].filter(([, value]) => value.trim() !== '');
  return SIDEBAR_FIELDS.filter(({ pattern }) => entries.some(([name]) => pattern.test(name))).map(({ words }) => words);
}

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

async function throughApi(attempt: PullAttempt): Promise<CreatePullOutcome> {
  if (location.origin !== 'https://github.com') return { ok: false, reason: 'unavailable', message: 'Retrying through the API works on github.com only.' };
  const request: CreatePullMessage = { type: 'geld:create-pull', attempt, viewer: viewer() };
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    return isCreatePullOutcome(answer) ? answer : { ok: false, reason: 'unavailable', message: 'Geld could not ask GitHub.' };
  } catch {
    return { ok: false, reason: 'unavailable', message: 'Geld could not ask GitHub.' };
  }
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

interface Mounted {
  readonly flash: HTMLElement;
  /** The buttons, floated into the flash's right side beside GitHub's close button, once Geld knows whether the reader is signed in, and rebuilt when that changes. */
  side: HTMLElement | null;
  /** The outcome and the `gh` command, under GitHub's message. */
  readonly root: HTMLElement;
  readonly message: string;
  readonly listeners: AbortController;
  busy: boolean;
}

let mounted: Mounted | null = null;

/** "Trigger via API" needs the reader's Geld App sign-in: without it only "Try again" is offered. */
async function apiSignedIn(): Promise<boolean> {
  if (location.origin !== 'https://github.com') return false;
  const request: ApiSignedInMessage = { type: 'geld:api-signed-in', viewer: viewer() };
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    return answer === true;
  } catch {
    return false;
  }
}

function mount(failure: CreateFailure, form: HTMLFormElement): Mounted {
  const listeners = new AbortController();
  const { signal } = listeners;
  const status = createElement('div', { class: 'geld-pull-retry__status', role: 'status' });
  const code = createElement('code');
  const copy = createElement('button', { type: 'button', class: 'btn-octicon geld-pull-retry__copy', 'aria-label': 'Copy command' }, [svgFromString(ICON_COPY)]);
  const block = createElement('div', { class: 'geld-pull-retry__block' }, [createElement('pre', { class: 'geld-pull-retry__command' }, [code]), copy]);
  const local = createElement('div', { class: 'geld-pull-retry__local' }, [createElement('span', {}, ['To run it yourself:']), block]);
  const root = createElement('div', { class: ROOT_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [status, local]);
  const state: Mounted = { flash: failure.flash, side: null, root, message: failure.message, listeners, busy: false };

  const command = (): string | null => {
    const attempt = attemptFromPage(form);
    return attempt === null ? null : ghCommand(attempt, location.host);
  };
  const showCommand = (): void => {
    const text = command();
    local.hidden = text === null;
    code.textContent = text ?? '';
  };
  showCommand();
  form.addEventListener('input', showCommand, { signal });

  copy.addEventListener(
    'click',
    () => {
      const text = command();
      if (text === null) return;
      void navigator.clipboard.writeText(text).then(() => {
        copy.replaceChildren(svgFromString(ICON_CHECK));
        setTimeout(() => copy.replaceChildren(svgFromString(ICON_COPY)), 1500);
      });
    },
    { signal },
  );

  failure.alert.after(root);
  // Signing in to Geld happens in its popup or another tab, so the answer is asked again whenever the page is returned to.
  let signedIn: boolean | null = null;
  const syncButtons = (): void => {
    void apiSignedIn().then((now) => {
      if (signal.aborted || state.busy || now === signedIn) return;
      signedIn = now;
      state.side?.remove();
      state.side = mountButtons(failure, form, state, status, now);
    });
  };
  syncButtons();
  window.addEventListener('focus', syncButtons, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) syncButtons();
    },
    { signal },
  );
  return state;
}

/** A button that may lead with Geld's emblem: the API one does, since only Geld can make that request for the reader. */
function retryButton(label: string, tooltip: string, signal: AbortSignal, mark: HTMLElement | null): HTMLButtonElement {
  const button = createElement('button', { type: 'button', class: 'btn btn-sm geld-pull-retry__try' }, [...(mark === null ? [] : [mark]), createElement('span', {}, [label])]);
  attachTooltipMessage(button, tooltip, signal);
  return button;
}

/** "Try again" always, and "Trigger via API" for a reader whose Geld App sign-in can make the request `gh` makes. */
function mountButtons(failure: CreateFailure, form: HTMLFormElement, state: Mounted, status: HTMLElement, signedIn: boolean): HTMLElement {
  const { signal } = state.listeners;
  const again = retryButton('Try again', RETRY_TOOLTIP, signal, null);
  const api = signedIn ? retryButton('Trigger via API', API_TOOLTIP, signal, brandMark('geld-pull-retry__mark')) : null;
  const buttons = api === null ? [again] : [again, api];
  const side = createElement('div', { class: 'geld-pull-retry__side', [OWN_UI_ATTRIBUTE]: '' }, buttons);

  const run = (button: HTMLButtonElement, working: string, work: (attempt: PullAttempt) => Promise<Outcome>, failed: string): void => {
    if (state.busy) return;
    const attempt = attemptFromPage(form);
    if (attempt === null) {
      status.textContent = 'Add a title first.';
      return;
    }
    state.busy = true;
    const face = [...button.childNodes];
    for (const other of buttons) other.disabled = other !== button;
    button.setAttribute('aria-busy', 'true');
    button.replaceChildren(svgFromString(ICON_SPINNER), createElement('span', {}, [working]));
    status.textContent = '';
    const startedOn = location.href;
    void work(attempt).then((outcome) => {
      // The reader left, or Geld stood down, while it ran: the answer belongs to a page that is gone.
      if (signal.aborted || location.href !== startedOn) return;
      if (outcome.ok) {
        status.textContent = 'Pull request opened.';
        location.assign(outcome.url);
        return;
      }
      state.busy = false;
      for (const other of buttons) other.disabled = false;
      button.removeAttribute('aria-busy');
      button.replaceChildren(...face);
      status.textContent = outcome === CANCELLED ? '' : `${failed} ${sentence(outcome.message)}`;
    });
  };
  again.addEventListener('click', () => run(again, 'Trying again…', () => resubmit(form, signal), 'Still failed.'), { signal });
  if (api !== null) {
    const viaApi = async (attempt: PullAttempt): Promise<Outcome> => {
      const left = sidebarChoices(form);
      if (left.length > 0 && !window.confirm(`The API opens the pull request with its title, description and branches. ${listWords(left)} chosen here will not be set. Open it anyway?`)) {
        return CANCELLED;
      }
      const answer = await throughApi(attempt);
      return answer.ok ? { ok: true, url: answer.url } : { ok: false, message: answer.message };
    };
    api.addEventListener('click', () => run(api, 'Opening…', viaApi, 'The API did not open it either.'), { signal });
  }

  // GitHub's close button floats right, so a float after it stands on its left. Without one the buttons lead the flash.
  const close = failure.flash.querySelector('.js-flash-close, .flash-close');
  if (close !== null) close.after(side);
  else failure.alert.before(side);
  return side;
}

/** Puts "Try again", "Trigger via API" for a signed-in reader and the `gh` command under GitHub's flash while the compare page says opening the pull request failed. */
export function applyCreatePullRetry(): void {
  const intact = mounted !== null && mounted.root.isConnected && (mounted.side === null || mounted.side.isConnected);
  if (mounted?.busy === true && intact) return;
  const failure = findCreateFailure();
  if (failure !== null && mounted !== null && intact && mounted.flash === failure.flash && mounted.message === failure.message) return;
  removeCreatePullRetry();
  const form = failure === null || !isRetryableFailure(failure.message) ? null : findCreateForm();
  if (failure === null || form === null || attemptFromPage(form) === null) return;
  mounted = mount(failure, form);
}

export function removeCreatePullRetry(): void {
  mounted?.listeners.abort();
  mounted?.side?.remove();
  mounted?.root.remove();
  mounted = null;
}
