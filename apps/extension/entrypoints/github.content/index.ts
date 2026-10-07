import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { GeldController, IDLE_STATE } from '../../src/github/controller';
import type { TabState, TabStateMessage } from '../../src/lib/messages';
import { isGetTabStateMessage, isPerfReportMessage, isRevealFileMessage, isToggleHiddenMessage } from '../../src/lib/messages';
import type { PerfSnapshot } from '../../src/lib/perf';
import { mark, snapshot as perfSnapshot } from '../../src/lib/perf';
import { loadCatalog, watchCatalog } from '../../src/lib/catalog';
import { repoConfigChoicesItem, whitespaceOptOutsItem } from '../../src/lib/local-state';
import { settingsItem } from '../../src/lib/storage';
import { redirectEarly } from '../../src/github/whitespace-viewed';
import './style.css';

/**
 * How long a retired copy waits before answering the background's ping. A
 * live copy in the same world answers at once and its answer is the one
 * delivered (the first `sendResponse` wins); this one only lands when no
 * live copy shares the world, and then only to say "the tab is taken".
 */
const RETIRED_ANSWER_MS = 100;

export default defineContentScript({
  matches: ['https://github.com/*'],
  // Start before the document is parsed so the header can be rewritten as soon
  // as it is inserted, ahead of the first paint, instead of after page load.
  runAt: 'document_start',
  async main(ctx) {
    // A newer copy of this script (injected after an update) announces itself;
    // any older copy still running in the page must step aside first.
    const TAKEOVER = 'geld:takeover';
    mark('script-start');
    document.dispatchEvent(new CustomEvent(TAKEOVER));
    // Listen before the first await: a copy injected while this one still loads its settings
    // would otherwise be missed, and two copies would then fight over the page.
    let retired = false;
    let controller: GeldController | null = null;
    // Retiring before the controller ran means this copy never showed anything on this tab; the trail says where
    // it stopped, and the console says so too, since a page with no Geld on it is otherwise silent about why.
    const retireEarly = (why: string): void => {
      retired = true;
      mark(`retired:${why}`);
      if (controller === null) console.warn(`[geld] stepped aside before starting on this tab (${why}); diagnostics on the options page have the trail.`);
    };
    let retire = (why: string): void => retireEarly(why);
    document.addEventListener(TAKEOVER, () => retire('takeover'), { once: true });
    // Registered now rather than after the controller starts: an extension reload during the awaits below is
    // otherwise not seen by this copy (`retire` is read when the event fires, so the full version applies later).
    ctx.onInvalidated(() => retire('invalidated'));

    // The background asks "is Geld in this tab?" (`hasContentScript`, src/lib/inject.ts) when the tab is
    // activated or the popup opens, and injects another copy when nothing answers. So this copy answers from
    // its first moment — before its settings have loaded — and keeps answering after it has retired: a copy
    // that fell silent made its own background inject a fresh one over the copy that had taken the page, which
    // retired *that* one, whose background then did the same, and the two panels took turns on the page. A
    // retired copy answers late and only with the idle state, so where a live copy shares its world (the
    // background injected the same build twice) the live copy's immediate answer is the one that counts; where
    // none does (two Geld builds installed, a store one and an unpacked one, and the other one won the page),
    // the idle answer still tells the background the tab is taken care of.
    const quietly = (step: () => void): void => {
      try {
        step();
      } catch {
        // Context invalidated: `chrome.runtime` is gone with it, and the listeners it would touch are dead.
      }
    };
    const onMessage = (message: unknown, _sender: unknown, sendResponse: (response: TabState | PerfSnapshot) => void): boolean | undefined => {
      if (retired) {
        // A retired copy still tells Copy diagnostics its trail, late, so a live copy's answer wins when there is
        // one and the trail of the copy that stepped aside is what gets reported when there is not.
        if (isPerfReportMessage(message) && window.top === window) {
          setTimeout(() => quietly(() => sendResponse(perfSnapshot())), RETIRED_ANSWER_MS);
          return true;
        }
        if (!(isGetTabStateMessage(message) || isToggleHiddenMessage(message) || isRevealFileMessage(message))) return undefined;
        setTimeout(() => quietly(() => sendResponse(IDLE_STATE)), RETIRED_ANSWER_MS);
        return true;
      }
      if (isPerfReportMessage(message)) {
        // Only the top frame counts: the page is what the reader sees, and frames would answer in its place.
        if (window.top !== window) return undefined;
        sendResponse(perfSnapshot());
        return undefined;
      }
      if (isToggleHiddenMessage(message)) {
        controller?.toggleHidden();
        sendResponse(controller?.getTabState() ?? IDLE_STATE);
        return undefined;
      }
      if (isRevealFileMessage(message)) {
        controller?.revealPath(message.path);
        sendResponse(controller?.getTabState() ?? IDLE_STATE);
        return undefined;
      }
      if (isGetTabStateMessage(message)) {
        sendResponse(controller?.getTabState() ?? IDLE_STATE);
        return undefined;
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);

    const [settings, whitespaceOptOuts] = await Promise.all([settingsItem.getValue(), whitespaceOptOutsItem.getValue()]);
    mark('settings');
    if (retired) return;
    // A diff page opened without GitHub's "hide whitespace" parameter goes to its `?w=1` form now, while the
    // document is still streaming, so the page is never seen without it (the controller handles later navigations).
    if (settings.hideWhitespace && window.top === window && redirectEarly(new URL(window.location.href), whitespaceOptOuts)) {
      mark('redirect-early');
      return;
    }
    const catalog = await loadCatalog();
    mark('catalog');
    if (retired) return;
    let showBadge = settings.showBadge;
    let published = false;

    const started = new GeldController(
      settings,
      {
        onTabState(state: TabState) {
          if (!published) {
            published = true;
            mark('published');
          }
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
    controller = started;
    mark('controller-start');
    started.start();

    const unwatchSettings = settingsItem.watch((settings) => {
      showBadge = settings.showBadge;
      started.updateSettings(settings);
    });
    // The background fetched a newer pattern catalog: apply it without a reload.
    const unwatchCatalog = watchCatalog((catalog) => started.updateCatalog(catalog));
    // The popup answered "use this repository's config?" (or the options page cleared the cache).
    const unwatchChoices = repoConfigChoicesItem.watch((choices) => started.updateRepoChoices(choices ?? {}));
    // Retiring often happens on a dead context (the extension was reloaded,
    // updated or removed with this tab open and `onInvalidated` fired).
    // `chrome.storage` is gone with it, so unsubscribing throws — wxt/storage
    // words it "You must add the 'storage' permission" — and the listeners it
    // would remove are already dead. Every step is best-effort.
    const unwatch = (): void => {
      quietly(unwatchSettings);
      quietly(unwatchCatalog);
      quietly(unwatchChoices);
    };

    // GitHub navigates with Turbo / React Router; the URL changes without a reload.
    ctx.addEventListener(window, 'wxt:locationchange', () => started.requestRefresh());
    ctx.addEventListener(document, 'turbo:load', () => started.requestRefresh());
    ctx.addEventListener(document, 'turbo:render', () => started.requestRefresh());
    ctx.addEventListener(document, 'soft-nav:end', () => started.requestRefresh());

    retire = (why: string): void => {
      if (retired) return;
      retired = true;
      mark(`retired:${why}`);
      unwatch();
      // The message listener stays: see `onMessage` above.
      started.stop();
      // This copy's background hears nothing more from the tab; its badge would keep this copy's last count.
      if (window.top === window) quietly(() => void browser.runtime.sendMessage({ type: 'geld:tab-state', state: IDLE_STATE } satisfies TabStateMessage).catch(() => undefined));
    };
  },
});
