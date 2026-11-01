import type { ProviderConversationRoot } from '../providers/types';

const NOTES = '[data-testid="noteable-note-container"], li.js-timeline-entry.system-note';

export function gitLabConversationRoots(doc: Document): readonly ProviderConversationRoot[] {
  const roots: ProviderConversationRoot[] = [];
  for (const root of doc.querySelectorAll<HTMLElement>(NOTES)) {
    if (root.closest('.issuable-discussion') === null || root.closest('[data-geld-ui]') !== null || !/^note_(?:[1-9]\d*|[a-f0-9]{8,64})$/.test(root.id)
      || root.querySelector('textarea, form, [contenteditable="true"]') !== null || root.querySelector(NOTES) !== null) continue;
    roots.push({ root, anchors: [root.id], kind: root.classList.contains('system-note') ? 'activity' : 'comment' });
  }
  return roots;
}

export function gitLabDescriptionHost(doc: Document): HTMLElement | null {
  const body = doc.querySelector<HTMLElement>('.issuable-discussion [data-testid="description-content"] > .md');
  return body?.closest('[data-geld-ui]') === null ? body : null;
}
