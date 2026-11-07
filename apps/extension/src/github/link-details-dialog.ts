import type { LinkDetails } from '@geld/review/link-resolvers/index';
import type { RelatedLink } from '@geld/review/related-links';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { inlineText } from './review/inline-text';
import { relativeTimeElement } from './review/time';
import { ICON_LINK_EXTERNAL, ICON_X } from './ui/icons';

let dialogs = 0;

/** Text as paragraphs, each line's inline Markdown (code, emphasis) rendered, nothing else: no HTML from the service. */
function paragraphs(text: string): HTMLElement[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const lines = block.split('\n');
      return createElement(
        'p',
        {},
        lines.flatMap((line, index) => [...inlineText(line), ...(index < lines.length - 1 ? [createElement('br')] : [])]),
      );
    });
}

function time(iso: string | null): HTMLElement | null {
  if (iso === null || !Number.isFinite(Date.parse(iso))) return null;
  return relativeTimeElement(new Date(iso).toISOString(), 'geld-related-dialog__time');
}

/**
 * What a connected account read of a related link, opened from its row: the title, its state and where it lives,
 * who wrote it and when it changed, then the description or the conversation's messages, and the way to the service.
 */
export function openLinkDetails(link: RelatedLink, details: LinkDetails, account: string): void {
  dialogs += 1;
  const titleId = `geld-link-details-${dialogs}-title`;
  const dialog = createElement('dialog', { class: 'Overlay Overlay-whenNarrow Overlay--size-medium Overlay--motion-scaleFade geld-related-dialog', [OWN_UI_ATTRIBUTE]: '', 'aria-labelledby': titleId });
  const close = createElement('button', { type: 'button', class: 'close-button Overlay-closeButton', 'aria-label': 'Close' }, [svgFromString(ICON_X)]);
  const updated = time(details.updatedAt);
  const meta = [details.where, details.author === null ? null : `by ${details.author}`].filter((part): part is string => part !== null && part !== '');
  const metaLine = createElement('p', { class: 'geld-related-dialog__meta' }, [
    ...(details.state === null ? [] : [createElement('span', { class: 'geld-related__state', 'data-tone': details.tone ?? 'neutral' }, [details.state])]),
    ...(meta.length === 0 ? [] : [createElement('span', {}, [meta.join(' · ')])]),
    ...(updated === null ? [] : [createElement('span', {}, ['updated ', updated])]),
  ]);
  const content =
    details.messages.length > 0
      ? createElement(
          'ol',
          { class: 'geld-related-dialog__messages' },
          details.messages.map((message) => {
            const at = time(message.at);
            return createElement('li', { class: 'geld-related-dialog__message' }, [
              createElement('p', { class: 'geld-related-dialog__byline' }, [createElement('strong', {}, [message.author ?? 'Someone']), ...(at === null ? [] : [' ', at])]),
              ...paragraphs(message.text),
            ]);
          }),
        )
      : details.body === null
        ? createElement('p', { class: 'geld-related-dialog__empty' }, ['No description.'])
        : createElement('div', { class: 'geld-related-dialog__body' }, paragraphs(details.body));
  const open = createElement('a', { class: 'btn btn-sm geld-related-dialog__open', href: link.href, target: '_blank', rel: 'noopener noreferrer' }, [svgFromString(ICON_LINK_EXTERNAL), link.action]);
  dialog.append(
    createElement('div', { class: 'Overlay-header Overlay-header--divided' }, [
      createElement('div', { class: 'Overlay-headerContentWrap' }, [
        createElement('div', { class: 'Overlay-titleWrap' }, [createElement('h1', { class: 'Overlay-title', id: titleId }, [details.title]), metaLine]),
        createElement('div', { class: 'Overlay-actionWrap' }, [close]),
      ]),
    ]),
    createElement('div', { class: 'Overlay-body geld-related-dialog__content' }, [content]),
    createElement('div', { class: 'Overlay-footer geld-related-dialog__footer' }, [
      createElement('span', { class: 'geld-related-dialog__from' }, [`Read with your ${[link.service, account].filter((part) => part !== '').join(' account ')}`]),
      open,
    ]),
  );
  const dismiss = (): void => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  close.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
