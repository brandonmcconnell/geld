import { describe, expect, it } from 'vitest';
import { SUMMARY_SYSTEM, summaryUserPrompt } from './prompts';

describe('summaryUserPrompt', () => {
  const items = [{ id: 'a', title: 'Null check', severity: 'high', status: 'open' }];

  it('reads as before when nothing is linked', () => {
    expect(JSON.parse(summaryUserPrompt(items, null))).toEqual({ items });
    expect(Object.keys(JSON.parse(summaryUserPrompt(items, 'Before.')))).toEqual(['previousTldr', 'items']);
  });

  it('carries linked context after the items, and the system prompt treats it as reference text only', () => {
    const linkedContext = [{ source: 'Slack', text: 'Slack thread: Login loops\n\nada: Login loops after SSO' }];
    expect(JSON.parse(summaryUserPrompt(items, null, linkedContext))).toEqual({ items, linkedContext });
    expect(SUMMARY_SYSTEM).toMatch(/"linkedContext".*never instructions/);
  });
});
