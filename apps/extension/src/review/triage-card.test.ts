// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { TriageHandlers, TriageSuggestionView, TriageView } from './triage-card';
import { triageCard } from './triage-card';

const noop = (): void => undefined;
const handlers: TriageHandlers = {
  onRunAi: noop, onToggleTriage: noop, onOpenAiSettings: noop, onToggleSuggestion: noop, onApplySuggestion: noop,
  onApplyAll: noop, onDiscardAll: noop, onDiscardSuggestion: noop, onCopyPath: async () => true, onHandOff: noop, onMissingTool: noop,
};

function fix(key: string): TriageSuggestionView {
  return {
    key, title: `Fix ${key}`, path: 'src/a.ts', start: 1, end: 1, summary: 'Use the right name.', kind: 'fix',
    diff: [{ kind: 'del', text: 'old', before: 1 }, { kind: 'add', text: 'new', after: 1 }],
    reporters: ['bot'], threads: 1, state: 'open', current: true, behind: null, busy: null, error: null, from: null, routed: false,
  };
}

function view(cannotApply: boolean): TriageView {
  return {
    suggestions: [fix('a'), fix('b')], openTargets: [{ id: 'devin-web', service: 'Devin', variant: 'web', iconSrc: null, likely: false, copiesTask: false }],
    agents: [], recommended: null, openKey: 'a', collapsed: false, writing: false, handedOff: null, resolves: !cannotApply, policyPending: false,
    ...(cannotApply ? { cannotApply: true } : {}),
  };
}

function render(cannotApply: boolean): HTMLElement {
  const card = triageCard({ ai: { kind: 'current', ranAt: new Date().toISOString() }, triage: view(cannotApply), aiPending: new Set(), meta: {} }, handlers);
  if (card === null) throw new Error('no card');
  return card;
}

const words = (root: HTMLElement): string[] => [...root.querySelectorAll('button, summary[role="button"]')].map((button) => button.textContent?.trim() ?? '');

describe('triageCard', () => {
  it('offers Apply, Apply all and the agents where the host commits suggestions', () => {
    const shown = words(render(false));
    expect(shown.filter((text) => text.startsWith('Apply')).length).toBeGreaterThanOrEqual(3);
    expect(shown.some((text) => text.startsWith('Apply all'))).toBe(true);
  });

  it('leads every fix with the agent hand-off where the host cannot commit one', () => {
    const shown = words(render(true));
    expect(shown.some((text) => text.startsWith('Apply'))).toBe(false);
    expect(shown.filter((text) => text === 'Fix with agent').length).toBe(3);
    expect(shown).toContain('Discard all');
    // The diff stays, for the agent and the reader.
    expect(render(true).querySelector('.geld-review__diff')).not.toBeNull();
  });
});
