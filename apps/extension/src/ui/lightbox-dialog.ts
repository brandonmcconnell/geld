import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../github/dom';
import { ICON_LINK_EXTERNAL, ICON_X } from '../github/ui/icons';
import './lightbox.css';

/** What a dialog shows: a video player or a PDF, with its own header control in place of Open original. */
export interface LightboxViewer {
  readonly stage: HTMLElement;
  /** The header's control in place of Open original. */
  readonly action?: HTMLElement;
  readonly mount?: () => void;
  readonly dispose: () => void;
}

/** The host's classes: GitHub's Primer button, or a provider's button and `geld-primer-bridge` on the dialog. */
export interface LightboxDialogSkin {
  readonly dialog?: string;
  readonly button: string;
}

export const GITHUB_LIGHTBOX_SKIN: LightboxDialogSkin = { button: 'btn btn-sm' };

let closeDialog: (() => void) | null = null;

/** Close the open video or PDF dialog, if any. */
export function closeLightboxDialog(): void {
  closeDialog?.();
}

/** Geld's card for one video or PDF, the same on every host: focus returns to `trigger` when it closes. */
export function showLightboxDialog(viewer: LightboxViewer, title: string, href: string, trigger: HTMLElement, skin: LightboxDialogSkin = GITHUB_LIGHTBOX_SKIN): () => void {
  closeDialog?.();
  const titleId = `geld-lightbox-title-${Date.now()}`;
  const dialog = createElement('dialog', {
    class: `geld-lightbox ${skin.dialog ?? ''}`.trim(),
    [OWN_UI_ATTRIBUTE]: '',
    'aria-labelledby': titleId,
  });
  const close = createElement('button', {
    type: 'button', class: 'geld-lightbox__close', 'aria-label': 'Close', title: 'Close (Esc)',
  }, [svgFromString(ICON_X)]);
  const original = viewer.action ?? createElement('a', {
    class: `${skin.button} geld-lightbox__original`, href, target: '_blank', rel: 'noopener noreferrer',
  }, ['Open original', svgFromString(ICON_LINK_EXTERNAL)]);
  dialog.append(
    createElement('header', { class: 'geld-lightbox__header' }, [
      createElement('h1', { class: 'geld-lightbox__title', id: titleId }, [title]),
      original,
      close,
    ]),
    createElement('div', { class: 'geld-lightbox__body' }, [viewer.stage]),
  );
  const dismiss = (): void => {
    if (closeDialog !== dismiss) return;
    closeDialog = null;
    viewer.dispose();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  };
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  // A host's own shortcuts can swallow the browser's Escape: the dialog closes on it first.
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    },
    { capture: true },
  );
  dialog.addEventListener('close', dismiss, { once: true });
  document.body.append(dialog);
  closeDialog = dismiss;
  dialog.showModal();
  viewer.mount?.();
  close.focus();
  return dismiss;
}
