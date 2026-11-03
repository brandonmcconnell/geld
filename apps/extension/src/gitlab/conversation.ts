import type { ProviderConversationRoot } from '../providers/types';

const NOTES = '[data-testid="noteable-note-container"], li.js-timeline-entry.system-note';

export function gitLabConversationRoots(doc: Document): readonly ProviderConversationRoot[] {
  const roots: ProviderConversationRoot[] = [];
  const seen = new Set<HTMLElement>();
  for (const note of doc.querySelectorAll<HTMLElement>(NOTES)) {
    if (note.closest('.issuable-discussion') === null || note.closest('[data-geld-ui]') !== null || !/^note_(?:[1-9]\d*|[a-f0-9]{8,64})$/.test(note.id)
      || note.querySelector('textarea, form, [contenteditable="true"]') !== null || note.querySelector(NOTES) !== null) continue;
    const discussion = note.closest<HTMLElement>('li.note-discussion');
    const root = discussion !== null && discussion.querySelector('textarea, form, [contenteditable="true"]') === null ? discussion : note;
    if (seen.has(root)) continue;
    const anchors = root === note ? [note.id] : [...root.querySelectorAll<HTMLElement>(NOTES)].map((entry) => entry.id);
    if (anchors.some((anchor) => !/^note_(?:[1-9]\d*|[a-f0-9]{8,64})$/.test(anchor))) continue;
    seen.add(root);
    roots.push({ root, anchors, kind: note.classList.contains('system-note') ? 'activity' : 'comment' });
  }

  return roots;
}

export function gitLabDescriptionHost(doc: Document): HTMLElement | null {
  const body = doc.querySelector<HTMLElement>('.issuable-discussion [data-testid="description-content"] > .md');
  return body?.closest('[data-geld-ui]') === null ? body : null;
}
