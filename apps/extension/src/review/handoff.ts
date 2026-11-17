import type { OpenTarget } from '@geld/review';
import { copyText } from '../github/review/actions';
import { countUsage } from '../lib/usage-count';

/** What a hand-off says under the triage card, and whether the reader may copy the task again (the copy failed). */
export type HandOffSaid = (text: string, copyAgain: boolean) => void;

/** Copy a finding's task for any coding agent, and say how it went: the same on every host. */
export function copyTask(task: string, said: HandOffSaid): void {
  void copyText(task).then((copied) => (copied ? said('Copied the task', false) : said('Could not copy the task. The browser did not take the task on the clipboard.', true)));
}

/**
 * Open a finding's task in an agent's web app or app (`OPEN_TARGETS`): the copy starts while the page still has focus,
 * and the tab opens in the click's own turn, which the browser's popup blocker requires; what is said waits for the
 * copy to settle. `url` is the target's link for this review, which a host builds (GitHub with its pull request).
 */
export function openTask(target: OpenTarget, url: string, task: string, said: HandOffSaid): void {
  countUsage('agent_handoff');
  const copying = target.copiesTask === true ? copyText(task) : null;
  // A web link opens in a tab; an app's own scheme is handed to the system from this page, leaving no blank tab.
  if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
  else {
    const link = document.createElement('a');
    link.href = url;
    link.click();
  }
  if (copying === null) said(`Opened in ${target.service}`, false);
  else void copying.then((copied) => (copied ? said(`Copied the task and opened ${target.service}. Paste it there to start`, false) : said(`Opened ${target.service}, but the task is not copied. The browser did not take the task on the clipboard.`, true)));
}
