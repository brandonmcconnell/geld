import { browser } from 'wxt/browser';
import type { ColorSchemeMessage } from '../../src/lib/messages';

const query = window.matchMedia('(prefers-color-scheme: dark)');

function report(): void {
  const message: ColorSchemeMessage = { type: 'geld:color-scheme', dark: query.matches };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

report();
query.addEventListener('change', report);
