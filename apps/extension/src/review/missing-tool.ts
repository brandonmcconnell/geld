import { browser } from 'wxt/browser';
import { missingToolDraft } from '../lib/feedback';
import type { MissingTool } from '../lib/feedback';
import type { OpenFeedbackMessage } from '../lib/messages';

/** "Don't see your preferred bot? Request it": opens the feedback page with its draft, from any host's digest. */
export function askForMissingTool(tool: MissingTool): void {
  const message: OpenFeedbackMessage = { type: 'geld:open-feedback', draft: missingToolDraft(tool) };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}
