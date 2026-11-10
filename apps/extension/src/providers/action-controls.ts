import type { ProviderReviewAction } from './types';

type ActionKind = ProviderReviewAction['kind'];
type CommentKind = 'comment' | 'review';
type Activate = (action: ProviderReviewAction, instant: boolean, commentKind?: CommentKind) => Promise<boolean>;

const NAMES: Readonly<Record<ActionKind, string>> = {
  approve: 'Approve', 'request-changes': 'Request changes', comment: 'Comment',
  'open-review': 'Open your review', 'open-pending-review': 'Open pending review',
};
const PATHS = {
  approve: 'm4 12 5 5L20 6',
  'request-changes': 'm5 5 14 14M19 5 5 19',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z',
};

export interface ProviderActionControls {
  readonly element: HTMLElement;
  destroy(): void;
}

export function renderProviderActionControls(doc: Document, provider: string, actions: readonly ProviderReviewAction[], activate: Activate): ProviderActionControls {
  const abort = new AbortController();
  const root = doc.createElement('div');
  root.className = 'geld-provider-actions';
  root.dataset.geldUi = '';
  root.setAttribute('role', 'group');root.setAttribute('aria-label', 'Review actions');
  const feedback = doc.createElement('span');
  feedback.className = 'geld-provider-actions__feedback';feedback.setAttribute('role', 'status');
  let panel: HTMLElement | null = null;
  let opener: HTMLButtonElement | null = null;
  let busy = false;
  const mac = /Mac|iPhone|iPad/.test(doc.defaultView?.navigator.platform ?? '');
  const close = (focus = false): void => {
    panel?.remove();panel = null;
    opener?.setAttribute('aria-expanded', 'false');
    if (focus && opener?.isConnected) opener.focus();
  };
  const run = async (action: ProviderReviewAction, instant: boolean, commentKind?: CommentKind): Promise<void> => {
    if (busy || !root.isConnected) return;
    busy = true;feedback.textContent = '';root.setAttribute('aria-busy', 'true');
    for (const button of root.querySelectorAll('button')) button.disabled = true;
    try {
      if (await activate(action, instant, commentKind)) close();
      else feedback.textContent = 'The review controls changed. Try again.';
    } catch { feedback.textContent = 'The review controls are unavailable. Try again.'; }
    finally {
      busy = false;root.removeAttribute('aria-busy');
      for (const button of root.querySelectorAll('button')) button.disabled = false;
    }
  };
  const choice = (label: string, click: () => void): HTMLButtonElement => {
    const button = doc.createElement('button');button.type = 'button';button.textContent = label;
    button.addEventListener('click', click, { signal: abort.signal });
    return button;
  };
  const open = (button: HTMLButtonElement, label: string): HTMLElement => {
    close();opener = button;button.setAttribute('aria-expanded', 'true');
    panel = doc.createElement('div');panel.className = 'geld-provider-actions__panel';
    panel.setAttribute('role', 'dialog');panel.setAttribute('aria-label', label);root.append(panel);
    return panel;
  };
  const available = actions.filter(action => action.available);
  const comments = available.filter(action => ['comment', 'open-review', 'open-pending-review'].includes(action.kind));
  const comment = comments.find(action => action.kind === 'comment');
  const review = comments.find(action => action.kind !== 'comment');
  const buttonFor = (kind: keyof typeof PATHS, action: ProviderReviewAction): void => {
    const button = doc.createElement('button');button.type = 'button';button.dataset.geldReviewAction = kind;
    const label = action.kind === 'comment' && action.commentKinds?.length === 1 && action.commentKinds[0] === 'review' ? 'Review' : NAMES[action.kind];button.setAttribute('aria-label', label);
    button.title = action.instant === undefined ? label : `${label}\n${mac ? '⌘' : 'Ctrl'} click without comments`;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');svg.setAttribute('width', '16');svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');svg.setAttribute('focusable', 'false');svg.setAttribute('data-geld-outline', '');
    svg.setAttribute('fill', 'none');svg.setAttribute('stroke', 'currentColor');svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');svg.setAttribute('stroke-linejoin', 'round');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');path.setAttribute('d', PATHS[kind]);svg.append(path);button.append(svg);
    if (action.requiresConfirmation || kind === 'comment' && (review !== undefined && comment !== undefined || (comment?.commentKinds?.length ?? 0) > 1)) {
      button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-expanded', 'false');
    }
    button.addEventListener('click', event => {
      if (busy) return;
      if (action.instant !== undefined && (mac ? event.metaKey : event.ctrlKey)) { void run(action, true);return; }
      if (panel !== null && opener === button) { close(true);return; }
      if (kind === 'comment' && (review !== undefined && comment !== undefined || (comment?.commentKinds?.length ?? 0) > 1)) {
        const menu = open(button, 'Comment or review');
        if (comment !== undefined) menu.append(choice('Comment', () => { void run(comment, false, 'comment'); }));
        if (comment?.commentKinds?.includes('review')) menu.append(choice('Review', () => { void run(comment, false, 'review'); }));
        else if (review !== undefined) menu.append(choice('Review', () => { void run(review, false); }));
        menu.querySelector('button')?.focus();return;
      }
      if (action.requiresConfirmation) {
        const menu = open(button, label);
        const title = doc.createElement('strong');title.textContent = label;menu.append(title);
        if (comment !== undefined) {
          const note = doc.createElement('p');note.textContent = `To include a comment, write it in ${provider}, then return here to ${kind === 'approve' ? 'approve' : 'request changes'}.`;menu.append(note);
          menu.append(choice('Write a comment', () => { void run(comment, false, 'comment'); }));
        }
        menu.append(choice(`${label} without comment`, () => { void run(action, false); }));
        menu.querySelector('button')?.focus();return;
      }
      void run(action, false, kind === 'comment' ? action.commentKinds?.[0] ?? 'comment' : undefined);
    }, { signal: abort.signal });
    root.append(button);
  };
  for (const kind of ['approve', 'request-changes'] as const) {
    const action = available.find(item => item.kind === kind);if (action !== undefined) buttonFor(kind, action);
  }
  const commentAction = comment ?? review;
  if (commentAction !== undefined) buttonFor('comment', commentAction);
  root.append(feedback);
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && panel !== null) { event.preventDefault();event.stopPropagation();close(true); } }, { signal: abort.signal });
  doc.addEventListener('pointerdown', event => { if (event.target instanceof Node && !root.contains(event.target)) close(); }, { signal: abort.signal });
  return { element: root, destroy() { abort.abort();close();root.remove(); } };
}
