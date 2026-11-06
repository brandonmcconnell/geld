import { browser } from 'wxt/browser';
import type { ColorSchemeMessage } from '../../src/lib/messages';
import { installErrorCapture } from '../../src/lib/error-capture';

installErrorCapture('offscreen');

const query = window.matchMedia('(prefers-color-scheme: dark)');
let dark: boolean | undefined;

function report(): void {
  if (query.matches === dark) return;
  dark = query.matches;
  const message: ColorSchemeMessage = { type: 'geld:color-scheme', dark };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

report();
query.addEventListener('change', report);
setInterval(report, 2000);
