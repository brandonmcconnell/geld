import { browser } from 'wxt/browser';
import type { CreatePullOutcome, PullAttempt } from '../lib/create-pull';
import { CREATE_FAILED_PREFIX, ghCommand, isRetryableFailure, pullAttemptFrom } from '../lib/create-pull';
import type { CreatePullMessage } from '../lib/messages';
import { isCreatePullOutcome } from '../lib/messages';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { brandMark } from './review/brand';
import { ICON_CHECK, ICON_COPY, ICON_SPINNER } from './ui/icons';
import { attachTooltipMessage } from './ui/tooltip';

/**
 * GitHub's compare form refuses a pull request with a flash ("Pull request creation failed. Validation failed: was
 * submitted too quickly") and renders the form again with the title and body kept. "Try with Geld" sends it again:
 * first the form itself through the reader's session, once it is old enough for GitHub's timing check, then the API
 * request `gh pr create` makes, with the reader's Geld App token where the App is installed. Nothing runs until the
 * reader asks, so it never races GitHub's own attempt.
 */

const ROOT_CLASS = 'geld-pull-retry';
const TOOLTIP = 'Geld can reattempt this failed operation, as the `gh` CLI would';
/** GitHub's forms carry the moment they were rendered, and a submission sooner than this after it is refused as too quick. */
const MIN_FORM_AGE_MS = 5000;
const MAX_WAIT_MS = 10_000;

export interface CreateFailure {
  readonly flash: HTMLElement;
  readonly alert: HTMLElement;
  readonly message: string;
}

export function findCreateFailure(root: ParentNode = document): CreateFailure | null {
  for (const flash of root.querySelectorAll<HTMLElement>('.flash-error')) {
    const alert = flash.querySelector<HTMLElement>('.js-flash-alert, [role="alert"]') ?? flash;
    const message = (alert.textContent ?? '').replace(/\s+/g, ' ').trim();
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
  const draft = /^(on|true|1)$/i.test(draftValue) || /\bdraft\b/i.test(submitter?.textContent ?? submitter?.value ?? '');
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

type PageOutcome = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

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

async function resubmit(form: HTMLFormElement): Promise<PageOutcome> {
  const wait = waitBeforeResubmit(form);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
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

async function throughApi(attempt: PullAttempt): Promise<CreatePullOutcome> {
  if (location.origin !== 'https://github.com') return { ok: false, reason: 'unavailable', message: 'Retrying through the API works on github.com only.' };
  const request: CreatePullMessage = { type: 'geld:create-pull', attempt };
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    return isCreatePullOutcome(answer) ? answer : { ok: false, reason: 'unavailable', message: 'Geld could not ask GitHub.' };
  } catch {
    return { ok: false, reason: 'unavailable', message: 'Geld could not ask GitHub.' };
  }
}

/** The page's form first, then the API. A final refusal (the pull request exists) ends it, whichever said so. */
async function retry(attempt: PullAttempt, form: HTMLFormElement): Promise<PageOutcome> {
  const page = await resubmit(form);
  if (page.ok || !isRetryableFailure(page.message)) return page;
  const api = await throughApi(attempt);
  if (api.ok) return { ok: true, url: api.url };
  return { ok: false, message: api.reason === 'unavailable' ? `${sentence(page.message)} ${api.message}` : api.message };
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

interface Mounted {
  readonly flash: HTMLElement;
  /** The button, floated into the flash's right side beside GitHub's close button. */
  readonly side: HTMLElement;
  /** The outcome and the `gh` line, under GitHub's message. */
  readonly root: HTMLElement;
  readonly message: string;
  readonly listeners: AbortController;
  busy: boolean;
}

let mounted: Mounted | null = null;

function mount(failure: CreateFailure, form: HTMLFormElement): Mounted {
  const listeners = new AbortController();
  const { signal } = listeners;
  const mark = brandMark('geld-pull-retry__mark');
  const label = createElement('span', {}, ['Try with Geld']);
  const button = createElement('button', { type: 'button', class: 'btn btn-sm geld-pull-retry__try' }, [mark, label]);
  attachTooltipMessage(button, TOOLTIP, signal);
  const side = createElement('div', { class: 'geld-pull-retry__side', [OWN_UI_ATTRIBUTE]: '' }, [button]);
  const status = createElement('div', { class: 'geld-pull-retry__status', role: 'status' });
  const code = createElement('code', { class: 'geld-pull-retry__command' });
  const copy = createElement('button', { type: 'button', class: 'btn-octicon geld-pull-retry__copy', 'aria-label': 'Copy command' }, [svgFromString(ICON_COPY)]);
  const local = createElement('div', { class: 'geld-pull-retry__local' }, [createElement('span', {}, ['To run it yourself:']), code, copy]);
  const root = createElement('div', { class: ROOT_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [status, local]);
  const state: Mounted = { flash: failure.flash, side, root, message: failure.message, listeners, busy: false };

  const command = (): string | null => {
    const attempt = attemptFromPage(form);
    return attempt === null ? null : ghCommand(attempt, location.host);
  };
  const showCommand = (): void => {
    const text = command();
    local.hidden = text === null;
    code.textContent = text ?? '';
    code.title = text ?? '';
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

  button.addEventListener(
    'click',
    () => {
      if (state.busy) return;
      const attempt = attemptFromPage(form);
      if (attempt === null) {
        status.textContent = 'Add a title first.';
        return;
      }
      state.busy = true;
      button.setAttribute('aria-busy', 'true');
      button.replaceChildren(svgFromString(ICON_SPINNER), createElement('span', {}, ['Trying again…']));
      status.textContent = '';
      void retry(attempt, form).then((outcome) => {
        if (outcome.ok) {
          status.textContent = 'Pull request opened.';
          location.assign(outcome.url);
          return;
        }
        state.busy = false;
        button.removeAttribute('aria-busy');
        button.replaceChildren(mark, label);
        status.textContent = `Geld's attempt failed too. ${sentence(outcome.message)}`;
      });
    },
    { signal },
  );

  // GitHub's close button floats right, so a float after it stands on its left. Without one the button leads the flash.
  const close = failure.flash.querySelector('.js-flash-close, .flash-close');
  if (close !== null) close.after(side);
  else failure.alert.before(side);
  failure.alert.after(root);
  return state;
}

/** Puts "Try with Geld" under GitHub's flash while the compare page says opening the pull request failed. */
export function applyCreatePullRetry(): void {
  if (mounted?.busy === true && mounted.root.isConnected && mounted.side.isConnected) return;
  const failure = findCreateFailure();
  if (failure !== null && mounted !== null && mounted.flash === failure.flash && mounted.message === failure.message && mounted.root.isConnected && mounted.side.isConnected) return;
  removeCreatePullRetry();
  const form = failure === null || !isRetryableFailure(failure.message) ? null : findCreateForm();
  if (failure === null || form === null || attemptFromPage(form) === null) return;
  mounted = mount(failure, form);
}

export function removeCreatePullRetry(): void {
  mounted?.listeners.abort();
  mounted?.side.remove();
  mounted?.root.remove();
  mounted = null;
}
