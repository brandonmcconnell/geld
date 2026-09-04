import { defineContentScript } from 'wxt/utils/define-content-script';
import { GeldController } from '../../src/github/controller';
import { settingsItem } from '../../src/lib/storage';
import './style.css';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const controller = new GeldController(await settingsItem.getValue());
    controller.start();

    const unwatch = settingsItem.watch((settings) => {
      controller.updateSettings(settings);
    });

    // GitHub navigates with Turbo / React Router; the URL changes without a reload.
    ctx.addEventListener(window, 'wxt:locationchange', () => controller.requestRefresh());
    ctx.addEventListener(document, 'turbo:load', () => controller.requestRefresh());
    ctx.addEventListener(document, 'turbo:render', () => controller.requestRefresh());
    ctx.addEventListener(document, 'soft-nav:end', () => controller.requestRefresh());

    ctx.onInvalidated(() => {
      unwatch();
      controller.stop();
    });
  },
});
