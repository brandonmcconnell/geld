import { browser } from 'wxt/browser';
import type { GetTabStateMessage, SetTabDisabledMessage } from '../../src/lib/messages';
import { isTabState } from '../../src/lib/messages';
import { bindSwitch } from '../../src/ui/switch';

interface OpenTab {
  readonly id: number;
  readonly title: string;
  readonly url: URL;
  /** `null` when no Geld answered in the tab (open since before an install, or the page is still loading). */
  readonly disabled: boolean | null;
}

async function openTabs(hosts: readonly string[]): Promise<readonly OpenTab[]> {
  if (hosts.length === 0) return [];
  const tabs = await browser.tabs.query({ url: hosts.map((host) => `https://${host}/*`) }).catch(() => []);
  const message: GetTabStateMessage = { type: 'geld:get-tab-state' };
  return Promise.all(
    tabs.flatMap((tab) => {
      if (tab.id === undefined || tab.url === undefined) return [];
      const id = tab.id;
      const url = new URL(tab.url);
      const title = tab.title ?? url.pathname;
      return [
        browser.tabs
          .sendMessage(id, message)
          .then((response: unknown): OpenTab => ({ id, title, url, disabled: isTabState(response) ? response.tabDisabled === true : null }))
          .catch((): OpenTab => ({ id, title, url, disabled: null })),
      ];
    }),
  );
}

function row(tab: OpenTab): HTMLElement {
  const label = document.createElement('span');
  label.className = 'geld-label options__tab-title';
  label.id = `tab-${tab.id}-label`;
  label.textContent = tab.title;
  const help = document.createElement('p');
  help.className = 'geld-help options__tab-url';
  help.id = `tab-${tab.id}-help`;
  const where = `${tab.url.hostname === 'github.com' ? '' : tab.url.hostname}${tab.url.pathname}`;
  help.textContent = tab.disabled === null ? `${where} · Reload this tab to use Geld in it.` : where;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'geld-switch';
  button.id = `tab-${tab.id}-switch`;
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-labelledby', label.id);
  button.setAttribute('aria-describedby', help.id);
  button.disabled = tab.disabled === null;
  bindSwitch(button, tab.disabled === false, async (on) => {
    const message: SetTabDisabledMessage = { type: 'geld:set-tab-disabled', disabled: !on };
    await browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
  });
  const text = document.createElement('div');
  text.className = 'options__tab-text';
  text.append(label, help);
  const line = document.createElement('div');
  line.className = 'geld-row';
  line.append(text, button);
  return line;
}

/** Temporary, for demos: one switch per open GitHub tab, each turning Geld off in that tab alone. */
export function mountTabSwitches(host: HTMLElement, empty: HTMLElement, hosts: () => readonly string[]): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const render = async (): Promise<void> => {
    const tabs = await openTabs(hosts());
    const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.id : null;
    const rows: Node[] = [];
    tabs.forEach((tab, index) => {
      if (index > 0) {
        const divider = document.createElement('hr');
        divider.className = 'options__divider';
        rows.push(divider);
      }
      rows.push(row(tab));
    });
    host.replaceChildren(...rows);
    empty.hidden = tabs.length > 0;
    if (focused !== null) document.getElementById(focused)?.focus();
  };
  const soon = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void render(), 200);
  };
  browser.tabs.onCreated.addListener(soon);
  browser.tabs.onRemoved.addListener(soon);
  browser.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === 'complete' || change.title !== undefined || change.url !== undefined) soon();
  });
  // Coming back from a tab: its choice may have changed by a reload or a navigation meanwhile.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) soon();
  });
  void render();
}
