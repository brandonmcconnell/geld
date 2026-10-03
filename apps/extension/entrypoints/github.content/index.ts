import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GeldController } from '../../src/github/controller';
import type { TabState, TabStateMessage } from '../../src/lib/messages';
import { isGetTabStateMessage, isPerfReportMessage, isRevealFileMessage, isToggleHiddenMessage } from '../../src/lib/messages';
import type { PerfSnapshot } from '../../src/lib/perf';
import { snapshot as perfSnapshot } from '../../src/lib/perf';
import { loadCatalog, watchCatalog } from '../../src/lib/catalog';
import { repoConfigChoicesItem, whitespaceOptOutsItem } from '../../src/lib/local-state';
import { settingsItem } from '../../src/lib/storage';
import { redirectEarly } from '../../src/github/whitespace-viewed';
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
    // Listen before the first await: a copy injected while this one still loads its settings
    // would otherwise be missed, and two copies would then fight over the page.
    let retired = false;
    let retire = (): void => {
      retired = true;
    };
    document.addEventListener(TAKEOVER, () => retire(), { once: true });

    const [settings, whitespaceOptOuts] = await Promise.all([settingsItem.getValue(), whitespaceOptOutsItem.getValue()]);
    if (retired) return;
    // A diff page opened without GitHub's "hide whitespace" parameter goes to its `?w=1` form now, while the
    // document is still streaming, so the page is never seen without it (the controller handles later navigations).
    if (settings.hideWhitespace && window.top === window && redirectEarly(new URL(window.location.href), whitespaceOptOuts)) return;
    const catalog = await loadCatalog();
    if (retired) return;
    let showBadge = settings.showBadge;

    const controller = new GeldController(
      settings,
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
      catalog,
    );
    controller.start();

    const unwatchSettings = settingsItem.watch((settings) => {
      showBadge = settings.showBadge;
      controller.updateSettings(settings);
    });
    // The background fetched a newer pattern catalog: apply it without a reload.
    const unwatchCatalog = watchCatalog((catalog) => controller.updateCatalog(catalog));
    // The popup answered "use this repository's config?" (or the options page cleared the cache).
    const unwatchChoices = repoConfigChoicesItem.watch((choices) => controller.updateRepoChoices(choices ?? {}));
    // Retiring usually happens on a dead context (the extension was reloaded,
    // updated or removed with this tab open, and either a newer copy took
    // over or `onInvalidated` fired). `chrome.storage` and
    // `chrome.runtime.onMessage` are gone with it, so unsubscribing throws —
    // wxt/storage words it "You must add the 'storage' permission" — and the
    // listeners it would remove are already dead. Every step is best-effort.
    const quietly = (step: () => void): void => {
      try {
        step();
      } catch {
        // Context invalidated: nothing left to unsubscribe from.
      }
    };
    const unwatch = (): void => {
      quietly(unwatchSettings);
      quietly(unwatchCatalog);
      quietly(unwatchChoices);
    };

    const onMessage = (message: unknown, _sender: unknown, sendResponse: (response: TabState | PerfSnapshot) => void): boolean | undefined => {
      if (isPerfReportMessage(message)) {
        // Only the top frame counts: the page is what the reader sees, and frames would answer in its place.
        if (window.top !== window) return undefined;
        sendResponse(perfSnapshot());
        return undefined;
      }
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

    retire = (): void => {
      if (retired) return;
      retired = true;
      unwatch();
      quietly(() => browser.runtime.onMessage.removeListener(onMessage));
      controller.stop();
    };
    // A newer copy took over (see TAKEOVER above, listened for from the start), or the
    // extension was reloaded, updated or removed and this copy is orphaned.
    ctx.onInvalidated(() => retire());
  },
});
