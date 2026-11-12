import { browser } from 'wxt/browser';
import type { PageKind } from '../github/page';
import { describePage } from '../github/page';
import type { FeedbackDraft } from '../lib/feedback';
import { draftParams } from '../lib/feedback';
import type { FeedbackOpenMessage, FeedbackRollback } from '../lib/messages';

/** "Chrome 148 on macOS", from the user agent, for the form's Browser field; blank when it cannot be told. */
export function describeBrowser(userAgent: string, platform: string): string {
  const name =
    /Edg\/(\d+)/.exec(userAgent)?.[1] !== undefined
      ? `Edge ${/Edg\/(\d+)/.exec(userAgent)?.[1] ?? ''}`
      : /Firefox\/(\d+)/.exec(userAgent)?.[1] !== undefined
        ? `Firefox ${/Firefox\/(\d+)/.exec(userAgent)?.[1] ?? ''}`
        : /Chrome\/(\d+)/.exec(userAgent)?.[1] !== undefined
          ? `Chrome ${/Chrome\/(\d+)/.exec(userAgent)?.[1] ?? ''}`
          : /Version\/(\d+).*Safari/.exec(userAgent)?.[1] !== undefined
            ? `Safari ${/Version\/(\d+).*Safari/.exec(userAgent)?.[1] ?? ''}`
            : '';
  const os = /Mac/i.test(platform) ? 'macOS' : /Win/i.test(platform) ? 'Windows' : /Linux/i.test(platform) ? 'Linux' : '';
  return [name, os].filter((part) => part !== '').join(' on ');
}

const PAGE_WORDS: Readonly<Record<Exclude<PageKind, 'other'>, string>> = {
  'pull-files': 'pull request files',
  'pull-conversation': 'pull request conversation',
  'pull-other': 'pull request',
  commit: 'commit',
  compare: 'compare',
};

/** The kind of GitHub page, in words for the feedback form: never its address. */
export function whereWords(url: URL): string {
  const kind = describePage(url).kind;
  if (kind !== 'other') return PAGE_WORDS[kind];
  return /\/pulls\b|\/issues\b/.test(url.pathname) ? 'pull request list' : 'other GitHub page';
}

export interface FeedbackOpening {
  /** The GitHub tab the reader came from, whose page the form may describe. */
  readonly tabId?: number;
  /** Tick the diagnostics report from the start (the options page's Report with diagnostics). */
  readonly diagnostics?: boolean;
  /** Start the draft about a Geld Nightly rollback (the panel's Leave feedback after Roll back). */
  readonly rollback?: FeedbackRollback;
  /** Words to start an empty draft with (a "Not listed?" link in the digest). */
  readonly draft?: FeedbackDraft;
}

/** The extension's own feedback page, which opens the issue from the reader's account without leaving the extension. */
export function feedbackPageUrl(opening: FeedbackOpening = {}): string {
  const url = new URL(browser.runtime.getURL('/feedback.html'));
  if (opening.tabId !== undefined) url.searchParams.set('tab', String(opening.tabId));
  if (opening.diagnostics === true) url.searchParams.set('diagnostics', '1');
  if (opening.rollback !== undefined) {
    url.searchParams.set('rollback-from', opening.rollback.from);
    url.searchParams.set('rollback-to', opening.rollback.to);
  }
  if (opening.draft !== undefined) draftParams(opening.draft, url.searchParams);
  return url.toString();
}

/** Bring the open feedback page forward when there is one, so two tabs never share and clear one draft; else open it. */
export async function openFeedback(opening: FeedbackOpening = {}): Promise<void> {
  const message: FeedbackOpenMessage = { type: 'geld:feedback-open', ...opening };
  const answered: unknown = await browser.runtime.sendMessage(message).catch(() => false);
  if (answered === true) return;
  await browser.tabs.create({ url: feedbackPageUrl(opening) });
}

/** Point a Feedback link at the feedback page, opened in a tab of its own. */
export function wireFeedbackLink(link: HTMLAnchorElement, opening: FeedbackOpening = {}): void {
  link.href = feedbackPageUrl(opening);
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void openFeedback(opening).then(() => {
      // The popup stays open behind a new tab in some browsers.
      if (location.pathname.endsWith('/popup.html')) window.close();
    });
  });
}
