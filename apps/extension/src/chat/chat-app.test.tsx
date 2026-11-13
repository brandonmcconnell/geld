// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat-app';
import { tokensOf } from './highlight';
import { safeUrl } from './markdown';
import { PortalContainer } from './portal';
import { TooltipProvider } from './ui/tooltip';
import type { ChatActions, ChatView } from './view';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function actions(): ChatActions {
  return { selectThread: vi.fn(), submit: vi.fn(), sendPrompt: vi.fn(), stop: vi.fn(), chooseModel: vi.fn(), clear: vi.fn(), close: vi.fn(), openSettings: vi.fn(), draftChanged: vi.fn() };
}

const COMPOSER = { placeholder: 'Message the agent…', models: [{ value: '', label: 'Agent’s model' }], model: '', modelDisabled: false, modelTitle: 'Model for the next reply', mode: 'send' as const, canSend: true, disabled: false };

function view(overrides: Partial<ChatView> = {}): ChatView {
  return {
    tabs: [
      { id: 'assistant', kind: 'assistant', label: 'Assistant', title: 'Assistant', running: false },
      { id: 'bc-1', kind: 'cursor', label: 'Fix the CI row', title: 'Cursor agent: Fix the CI row', running: true },
    ],
    active: 'bc-1',
    bar: { text: 'Same conversation as in Cursor', status: { words: 'Working', running: true }, link: { label: 'Open in Cursor', href: 'https://cursor.com/agents/bc-1' } },
    body: {
      kind: 'turns',
      turns: [
        { id: 'u1', role: 'user', author: 'cursor', text: 'Bring the list back', tools: [], streaming: false, error: null, note: null },
        { id: 'a1', role: 'assistant', author: 'cursor', text: 'Fixed in `overview.ts`.', tools: [{ callId: 'c1', line: 'Read overview.ts', done: true }], streaming: false, error: null, note: null },
      ],
      pending: null,
      notices: [],
    },
    canClear: false,
    composer: COMPOSER,
    ...overrides,
  };
}

function render(chat: ChatView, handlers: ChatActions): HTMLElement {
  const container = document.createElement('div');
  const portal = document.createElement('div');
  document.body.append(container, portal);
  const root = createRoot(container);
  act(() =>
    root.render(
      <PortalContainer.Provider value={portal}>
        <TooltipProvider>
          <ChatPanel view={chat} actions={handlers} />
        </TooltipProvider>
      </PortalContainer.Provider>,
    ),
  );
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('chat panel', () => {
  it('renders the tabs, the bar, the turns and their tool lines from the view', () => {
    const container = render(view(), actions());
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Assistant', 'Fix the CI row']);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Working');
    expect(container.querySelector('a[href="https://cursor.com/agents/bc-1"]')?.getAttribute('target')).toBe('_blank');
    expect(container.querySelector('[data-slot="bubble-content"]')?.textContent).toBe('Bring the list back');
    expect(container.querySelector('[data-slot="trace-title"]')?.textContent).toBe('Read overview.ts');
  });

  it('switches threads with the arrow keys and closes on Escape', () => {
    const handlers = actions();
    const container = render(view(), handlers);
    const list = container.querySelector('[role="tablist"]');
    act(() => list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(handlers.selectThread).toHaveBeenCalledWith('assistant');
    act(() => list?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(handlers.close).toHaveBeenCalled();
  });

  it('offers the setup actions and quick prompts of an empty thread', () => {
    const handlers = actions();
    const container = render(view({ body: { kind: 'empty', title: 'Ask about this pull request', text: 'Words', actions: [{ kind: 'settings', label: 'Open settings' }], prompts: ['What could break?'] } }), handlers);
    const buttons = [...container.querySelectorAll('button')];
    act(() => buttons.find((button) => button.textContent === 'What could break?')?.click());
    expect(handlers.sendPrompt).toHaveBeenCalledWith('What could break?');
    act(() => buttons.find((button) => button.textContent === 'Open settings')?.click());
    expect(handlers.openSettings).toHaveBeenCalled();
  });

  it('turns the send button into Stop while the assistant replies', () => {
    const handlers = actions();
    const container = render(view({ composer: { ...COMPOSER, mode: 'stop' } }), handlers);
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.getAttribute('aria-label')).toBe('Stop the reply');
    expect(submit?.disabled).toBe(false);
    act(() => submit?.click());
    expect(handlers.stop).toHaveBeenCalled();
  });
});

describe('chat markdown', () => {
  it('keeps only http, https and mailto addresses', () => {
    expect(safeUrl('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
    expect(safeUrl('/o/r/pull/1')).toBe('/o/r/pull/1');
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:image/png;base64,AAAA')).toBe('');
  });

  it('colours code with GitHub’s syntax tokens, line by line', () => {
    const lines = tokensOf('const a = 1;\n// done', 'ts');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.find((token) => token.content === 'const')?.color).toBe('var(--color-prettylights-syntax-keyword)');
    expect(lines[0]?.find((token) => token.content === '1')?.color).toBe('var(--color-prettylights-syntax-constant)');
    expect(lines[1]?.[0]?.color).toBe('var(--color-prettylights-syntax-comment)');
  });
});
