import { browser } from 'wxt/browser';
import { settingsItem } from '../../src/lib/storage';
import { bindSwitch, requireElement } from '../../src/ui/switch';

async function main(): Promise<void> {
  const settings = await settingsItem.getValue();
  const status = requireElement('status', HTMLSpanElement);

  const reportSaved = (): void => {
    status.textContent = 'Saved';
    status.dataset.tone = 'success';
    setTimeout(() => {
      status.textContent = '';
      delete status.dataset.tone;
    }, 1200);
  };

  const enabledSwitch = bindSwitch(requireElement('enabled', HTMLButtonElement), settings.enabled, async (enabled) => {
    await settingsItem.patch({ enabled });
    reportSaved();
  });

  const expandedSwitch = bindSwitch(
    requireElement('expanded', HTMLButtonElement),
    settings.expandedByDefault,
    async (expandedByDefault) => {
      await settingsItem.patch({ expandedByDefault });
      reportSaved();
    },
  );

  settingsItem.watch((next) => {
    enabledSwitch.set(next.enabled);
    expandedSwitch.set(next.expandedByDefault);
  });

  requireElement('open-options', HTMLButtonElement).addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });
}

void main();
