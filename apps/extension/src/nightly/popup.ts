import { browser } from 'wxt/browser';
import { isNightlyInstallResult } from './messages';
import type { NightlyInstallMessage } from './messages';
import { buildOf, compareVersions } from './release';
import { nightlyStatusItem } from './state';
import type { NightlyStatus } from './state';

/** The popup's nightly line: which build this is and, when a newer one is out, the button that installs it. */

function openNightlyPage(): void {
  void browser.tabs.create({ url: new URL('/nightly.html', location.origin).href }).then(() => window.close());
}

function render(section: HTMLElement, status: NightlyStatus): void {
  const version = browser.runtime.getManifest().version;
  const build = buildOf(version);
  const latest = status.latest;
  const newer = latest !== null && compareVersions(latest.version, version) > 0;
  const text = document.createElement('p');
  text.className = 'popup__context-line';
  text.textContent = newer && latest !== null ? `Nightly build ${latest.build} is ready` : `Nightly ${build === null ? version : `build ${build}`}`;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'geld-button geld-button--small';
  if (status.installing !== null) {
    action.textContent = 'Installing…';
    action.disabled = true;
  } else if (newer) {
    action.textContent = 'Install';
    action.classList.add('geld-button--primary');
    action.addEventListener('click', () => {
      action.disabled = true;
      action.textContent = 'Installing…';
      const request: NightlyInstallMessage = { type: 'geld:nightly-install' };
      void browser.runtime.sendMessage(request).then((result: unknown) => {
        if (!isNightlyInstallResult(result) || !result.ok) openNightlyPage();
      });
    });
  } else {
    action.textContent = 'Updates';
    action.classList.add('geld-button--link');
    action.addEventListener('click', openNightlyPage);
  }
  section.replaceChildren(text, action);
}

export function mountNightlyPopup(host: HTMLElement): void {
  const section = document.createElement('section');
  section.className = 'popup__section geld-row';
  host.prepend(section);
  void nightlyStatusItem.getValue().then((status) => render(section, status));
  nightlyStatusItem.watch((status) => render(section, status));
}
