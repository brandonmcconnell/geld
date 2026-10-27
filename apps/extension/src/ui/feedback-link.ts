import { browser } from 'wxt/browser';

/** Where feedback goes: the site's `/feedback`, which forwards to wherever feedback is taken (a GitHub issue form today). */
export const FEEDBACK_URL = 'https://www.geld.sh/feedback';

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

/**
 * Point a Feedback link at the site with the context the issue form asks
 * for: the extension's version and the browser, plus where the reader was
 * (`page`) when known. Nothing personal: no URL, no login.
 */
export function wireFeedbackLink(link: HTMLAnchorElement, page: string | null = null): void {
  const url = new URL(FEEDBACK_URL);
  url.searchParams.set('version', browser.runtime.getManifest().version);
  const described = describeBrowser(navigator.userAgent, navigator.platform);
  if (described !== '') url.searchParams.set('browser', described);
  if (page !== null && page !== '') url.searchParams.set('page', page);
  link.href = url.toString();
}
