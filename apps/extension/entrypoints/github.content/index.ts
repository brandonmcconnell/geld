import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GeldController } from '../../src/github/controller';
import type { TabState, TabStateMessage } from '../../src/lib/messages';
import { isGetTabStateMessage, isRevealFileMessage, isToggleHiddenMessage } from '../../src/lib/messages';
import { loadCatalog, watchCatalog } from '../../src/lib/catalog';
import { settingsItem } from '../../src/lib/storage';
import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  // Start before the document is parsed so the header can be rewritten as soon
  // as it is inserted, ahead of the first paint, instead of after page load.
  runAt: 'document_start',
  async main(ctx) {
    // A newer copy of this script (injected after an update) announces itself;
    // any older copy still running in the page must step aside first.
    const TAKEOVER = 'geld:takeover';
    document.dispatchEvent(new CustomEvent(TAKEOVER));

    let showBadge = (await settingsItem.getValue()).showBadge;

    const controller = new GeldController(
      await settingsItem.getValue(),
      {
        onTabState(state: TabState) {
          // Only the top frame drives the badge; the count is what the user sees on this tab.
          if (window.top !== window) return;
          const message: TabStateMessage = {
            type: 'geld:tab-state',
            state: showBadge ? state : { ...state, hiddenCount: 0 },
          };
          void browser.runtime.sendMessage(message).catch(() => undefined);
        },
      },
      await loadCatalog(),
    );
    controller.start();

    const unwatchSettings = settingsItem.watch((settings) => {
      showBadge = settings.showBadge;
      controller.updateSettings(settings);
    });
    // The background fetched a newer pattern catalog: apply it without a reload.
    const unwatchCatalog = watchCatalog((catalog) => controller.updateCatalog(catalog));
    const unwatch = (): void => {
      unwatchSettings();
      unwatchCatalog();
    };

    const onMessage = (message: unknown, _sender: unknown, sendResponse: (response: TabState) => void): boolean | undefined => {
      if (isToggleHiddenMessage(message)) {
        controller.toggleHidden();
        sendResponse(controller.getTabState());
        return undefined;
      }
      if (isRevealFileMessage(message)) {
        controller.revealPath(message.path);
        sendResponse(controller.getTabState());
        return undefined;
      }
      if (isGetTabStateMessage(message)) {
        sendResponse(controller.getTabState());
        return undefined;
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);

    // GitHub navigates with Turbo / React Router; the URL changes without a reload.
    ctx.addEventListener(window, 'wxt:locationchange', () => controller.requestRefresh());
    ctx.addEventListener(document, 'turbo:load', () => controller.requestRefresh());
    ctx.addEventListener(document, 'turbo:render', () => controller.requestRefresh());
    ctx.addEventListener(document, 'soft-nav:end', () => controller.requestRefresh());

    let retired = false;
    const retire = (): void => {
      if (retired) return;
      retired = true;
      unwatch();
      browser.runtime.onMessage.removeListener(onMessage);
      controller.stop();
    };
    // A newer copy took over (see TAKEOVER above), or the extension was
    // reloaded, updated or removed and this copy is orphaned.
    document.addEventListener(TAKEOVER, retire, { once: true });
    ctx.onInvalidated(retire);
  },
});
