export interface ProviderBotRequest {
  readonly key: string;
  readonly botId: string;
  readonly label: string;
  readonly sourceUrl: string;
  readonly commands: readonly { readonly id: string; readonly label: string; readonly text: string }[];
  current(): boolean;
  readonly comment: {
    readonly available: boolean;
    readonly reason?: string;
    activate(): Promise<boolean>;
  };
}

export interface ProviderBotRequestControl {
  readonly element: HTMLDetailsElement;
  update(request: ProviderBotRequest): void;
  destroy(): void;
}

export function renderProviderBotRequest(host: HTMLElement, initial: ProviderBotRequest, copyText: (text: string) => void | Promise<void>): ProviderBotRequestControl {
  const doc = host.ownerDocument;
  let request = initial;
  let destroyed = false;
  let pending = false;
  const element = doc.createElement('details');
  element.dataset.geldUi = '';
  element.dataset.geldBotRequest = initial.key;
  const summary = doc.createElement('summary');
  summary.textContent = `Prepare ${initial.label} request`;
  const modes = doc.createElement('div');
  modes.className = 'geld-provider-review__source-actions';
  modes.setAttribute('role', 'group');modes.setAttribute('aria-label', 'Review command mode');
  const preview = doc.createElement('code');
  preview.dataset.geldBotCommand = '';
  const source = doc.createElement('a');
  source.textContent = 'View original review';
  try {
    const url = new URL(initial.sourceUrl);
    if (['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === '') source.href = url.href;
  } catch { /* A missing source link never becomes an executable URL. */ }
  const explanation = doc.createElement('p');
  explanation.className = 'geld-provider-review__muted';
  explanation.textContent = 'Copy a command, then paste and post it in the native comment writer. Existing drafts are kept.';
  const actions = doc.createElement('div');
  actions.className = 'geld-provider-review__source-actions';
  const copy = doc.createElement('button');
  copy.type = 'button';copy.textContent = 'Copy command';copy.dataset.geldBotRequestAction = 'copy';
  const open = doc.createElement('button');
  open.type = 'button';open.textContent = 'Open native comment';open.dataset.geldBotRequestAction = 'comment';
  const cancel = doc.createElement('button');
  cancel.type = 'button';cancel.textContent = 'Cancel';
  const notice = doc.createElement('p');
  notice.className = 'geld-provider-review__muted';notice.setAttribute('role', 'status');notice.setAttribute('aria-live', 'polite');
  const choices: HTMLButtonElement[] = [];
  let selected = initial.commands[0]?.id;
  const current = (key = initial.key): boolean => !destroyed && element.isConnected && request.key === key && request.current();
  const sync = (): void => {
    preview.textContent = request.commands.find((mode) => mode.id === selected)?.text ?? '';
    copy.disabled = pending || !current() || preview.textContent === '';
    open.disabled = pending || !current() || !request.comment.available;
    open.title = request.comment.reason ?? '';
    for (const [index, button] of choices.entries()) {
      button.disabled = pending;button.setAttribute('aria-pressed', String(request.commands[index]?.id === selected));
    }
  };
  for (const mode of initial.commands.length > 1 ? initial.commands : []) {
    const button = doc.createElement('button');
    button.type = 'button';button.textContent = mode.label;
    button.addEventListener('click', () => { if (!pending && current()) { selected = mode.id;notice.textContent = '';sync(); } });
    choices.push(button);modes.append(button);
  }
  const perform = (operation: () => Promise<string>, failure = 'Could not copy the command. Try again.'): void => {
    if (pending || !current()) return;
    pending = true;notice.textContent = '';actions.setAttribute('aria-busy', 'true');sync();
    const key = request.key;
    void operation().then((message) => { if (current(key)) notice.textContent = message; }).catch(() => {
      if (current(key)) notice.textContent = failure;
    }).finally(() => {
      pending = false;
      if (current(key)) { actions.removeAttribute('aria-busy');sync(); }
    });
  };
  copy.addEventListener('click', () => {
    const mode = request.commands.find((mode) => mode.id === selected);
    if (mode === undefined || copy.disabled) return;
    perform(async () => {
      if (!current()) return '';
      await copyText(mode.text);
      return 'Command copied. Paste it into the native comment writer and post when ready.';
    });
  });
  open.addEventListener('click', () => {
    if (open.disabled) return;
    perform(async () => await request.comment.activate() ? 'Native comment writer opened. Your draft is unchanged.' : 'The native comment writer is no longer available.', 'Could not open the native comment writer. Your draft was not replaced.');
  });
  const dismiss = (): void => { element.open = false;summary.focus(); };
  cancel.addEventListener('click', dismiss);
  element.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();dismiss(); } });
  actions.append(copy, open, cancel);
  element.append(summary, explanation, source);
  if (initial.commands.length > 1) element.append(modes);
  element.append(preview, actions, notice);
  host.append(element);sync();
  return { element, update(next) { request = next;sync(); }, destroy() { destroyed = true;element.remove(); } };
}
