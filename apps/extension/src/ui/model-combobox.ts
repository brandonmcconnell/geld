import type { ModelInfo } from '@geld/review';

/**
 * A combobox over a gateway's model list: type to filter by id or name,
 * arrow through the matches, Enter or click to pick; an id the list does not
 * know can still be typed and saved. Each option shows the id with the
 * gateway's facts about the model beside it (maker, context window, tags),
 * which is what the list can say for free; speed and intelligence would need
 * a benchmark source (Artificial Analysis publishes one behind an API key)
 * and are left for later.
 *
 * WAI-ARIA combobox pattern: the input owns `aria-expanded`, `aria-controls`
 * and `aria-activedescendant`; the popup is a `listbox` of `option`s.
 */

export interface ModelComboboxOptions {
  readonly id: string;
  readonly labelledBy: string;
  readonly placeholder: string;
  readonly initial: string;
}

export interface ModelCombobox {
  readonly root: HTMLElement;
  /** The current text, trimmed. */
  value(): string;
  /** Whether the list knows this id. */
  has(id: string): boolean;
  size(): number;
  setOptions(models: readonly ModelInfo[]): void;
  setDisabled(disabled: boolean): void;
}

const MAX_SHOWN = 60;

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`;
  return `${tokens} ctx`;
}

function metaOf(model: ModelInfo): string {
  const parts: string[] = [];
  if (model.provider !== undefined && !model.id.toLowerCase().startsWith(`${model.provider.toLowerCase()}/`)) parts.push(model.provider);
  if (model.context !== undefined) parts.push(formatContext(model.context));
  for (const tag of (model.tags ?? []).slice(0, 2)) parts.push(tag);
  return parts.join(' · ');
}

function matches(model: ModelInfo, query: string): boolean {
  if (query === '') return true;
  const haystack = `${model.id} ${model.name ?? ''} ${model.provider ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '')
    .every((token) => haystack.includes(token));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: ReadonlyArray<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

export function modelCombobox(options: ModelComboboxOptions): ModelCombobox {
  let models: readonly ModelInfo[] = [];
  let shown: readonly ModelInfo[] = [];
  let active = -1;

  const input = el('input', 'geld-input geld-code options__input options__input--grow');
  input.id = options.id;
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = options.placeholder;
  input.value = options.initial;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-labelledby', options.labelledBy);
  input.setAttribute('autocomplete', 'off');
  const listId = `${options.id}-listbox`;
  input.setAttribute('aria-controls', listId);
  const list = el('ul', 'options__combo-list');
  list.id = listId;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const toggle = el('button', 'options__combo-toggle', ['▾']);
  toggle.type = 'button';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', 'Show models');
  const root = el('div', 'options__combo', [input, toggle, list]);

  const optionId = (index: number): string => `${listId}-${index}`;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const render = (query: string): void => {
    const all = models.filter((model) => matches(model, query));
    shown = all.slice(0, MAX_SHOWN);
    list.replaceChildren();
    if (shown.length === 0) {
      list.append(el('li', 'options__combo-empty', [models.length === 0 ? 'No models listed yet' : 'No model matches']));
    }
    shown.forEach((model, index) => {
      const item = el('li', 'options__combo-option', [el('span', 'geld-code options__combo-id', [model.id])]);
      const meta = metaOf(model);
      if (meta !== '') item.append(el('span', 'options__combo-meta', [meta]));
      item.id = optionId(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(model.id === input.value.trim()));
      item.addEventListener('mousedown', (event) => {
        // Before blur: the pick lands before the list closes.
        event.preventDefault();
        pick(model.id);
      });
      list.append(item);
    });
    if (all.length > shown.length) list.append(el('li', 'options__combo-empty', [`${all.length - shown.length} more; keep typing to narrow`]));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  };

  const setActive = (index: number): void => {
    const items = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    for (const item of items) item.removeAttribute('data-active');
    active = index;
    const current = items[index];
    if (current === undefined) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    current.setAttribute('data-active', '');
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  };

  const pick = (id: string): void => {
    input.value = id;
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  input.addEventListener('input', () => render(input.value.trim()));
  input.addEventListener('focus', () => render(input.value.trim()));
  input.addEventListener('blur', () => close());
  toggle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (input.disabled) return;
    if (list.hidden) {
      input.focus();
      render('');
    } else {
      close();
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) render(input.value.trim());
      const count = shown.length;
      if (count === 0) return;
      setActive(event.key === 'ArrowDown' ? (active + 1) % count : (active - 1 + count) % count);
    } else if (event.key === 'Enter') {
      const chosen = shown[active];
      if (!list.hidden && chosen !== undefined) {
        event.preventDefault();
        pick(chosen.id);
      }
    } else if (event.key === 'Escape') {
      if (!list.hidden) {
        event.preventDefault();
        close();
      }
    }
  });

  return {
    root,
    value: () => input.value.trim(),
    has: (id) => models.some((model) => model.id === id),
    size: () => models.length,
    setOptions: (next) => {
      models = [...next].sort((a, b) => a.id.localeCompare(b.id));
      if (!list.hidden) render(input.value.trim());
    },
    setDisabled: (disabled) => {
      input.disabled = disabled;
      toggle.disabled = disabled;
      if (disabled) close();
    },
  };
}
