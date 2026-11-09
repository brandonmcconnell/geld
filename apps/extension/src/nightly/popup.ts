import { browser } from 'wxt/browser';
import { isNightlyInstallResult } from './messages';
import type { NightlyCheckMessage, NightlyInstallMessage, NightlyRollbackMessage } from './messages';
import { mountNightlyPanel } from './panel';
import type { NightlyAction } from './view';

/**
 * The popup's nightly panel. A folder picker or Chrome's permission prompt would close the popup, so what
 * needs one (connecting the folder, an install Chrome has to allow) continues on the nightly page.
 */

function openNightlyPage(): void {
  void browser.tabs.create({ url: new URL('/nightly.html', location.origin).href }).then(() => window.close());
}

async function act(kind: NightlyAction): Promise<string | null> {
  if (kind === 'connect') {
    openNightlyPage();
    return null;
  }
  if (kind === 'check') {
    const request: NightlyCheckMessage = { type: 'geld:nightly-check' };
    await browser.runtime.sendMessage(request);
    return null;
  }
  const request: NightlyInstallMessage | NightlyRollbackMessage = { type: kind === 'install' || kind === 'retry' ? 'geld:nightly-install' : 'geld:nightly-rollback' };
  const result: unknown = await browser.runtime.sendMessage(request);
  if (!isNightlyInstallResult(result)) return 'Geld did not answer. Try again.';
  if (result.ok) return null;
  if (result.need !== undefined) {
    openNightlyPage();
    return null;
  }
  return result.reason;
}

export function mountNightlyPopup(host: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'popup__section';
  host.prepend(section);
  mountNightlyPanel(section, act);
}
