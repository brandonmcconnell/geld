import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GeldController } from '../../src/github/controller';
import type { TabState, TabStateMessage } from '../../src/lib/messages';
import { isGetTabStateMessage, isToggleHiddenMessage } from '../../src/lib/messages';
import { settingsItem } from '../../src/lib/storage';
import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    let showBadge = (await settingsItem.getValue()).showBadge;

    const controller = new GeldController(await settingsItem.getValue(), {
      onTabState(state: TabState) {
        // Only the top frame drives the badge; the count is what the user sees on this tab.
        if (window.top !== window) return;
        const message: TabStateMessage = {
          type: 'geld:tab-state',
          state: showBadge ? state : { ...state, hiddenCount: 0 },
        };
        void browser.runtime.sendMessage(message).catch(() => undefined);
      },
    });
    controller.start();

    const unwatch = settingsItem.watch((settings) => {
      showBadge = settings.showBadge;
      controller.updateSettings(settings);
    });

    const onMessage = (message: unknown, _sender: unknown, sendResponse: (response: TabState) => void): boolean | undefined => {
      if (isToggleHiddenMessage(message)) {
        controller.toggleHidden();
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

    ctx.onInvalidated(() => {
      unwatch();
      browser.runtime.onMessage.removeListener(onMessage);
      controller.stop();
    });
  },
});
