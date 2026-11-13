import { describe, expect, it } from 'vitest';
import { agentLiveStep, agentRunning, IDLE_LIVE, turnsFromHistory } from './chat-threads';

const history = [
  { id: 'm1', role: 'user' as const, text: 'Add a README' },
  { id: 'm2', role: 'assistant' as const, text: 'Added it.' },
  { id: 'm3', role: 'user' as const, text: 'Also a license' },
  { id: 'm4', role: 'assistant' as const, text: 'Working on' },
];

describe('chat threads', () => {
  it('keeps the whole history of an idle agent', () => {
    expect(turnsFromHistory(history, false).map((turn) => turn.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('leaves out the running turn’s words, which the stream plays again', () => {
    expect(turnsFromHistory(history, true).map((turn) => turn.id)).toEqual(['m1', 'm2', 'm3']);
    expect(turnsFromHistory([{ id: 'a', role: 'assistant', text: 'x' }], true)).toEqual([]);
  });

  it('builds the live turn from the stream: status, text, tool calls, then the result', () => {
    let live = agentLiveStep(IDLE_LIVE, { kind: 'status', status: 'RUNNING', runId: null });
    expect(agentRunning(live, null)).toBe(true);
    expect(live.turn?.streaming).toBe(true);
    live = agentLiveStep(live, { kind: 'assistant', text: 'Reading ' });
    live = agentLiveStep(live, { kind: 'tool', callId: 'c1', name: 'read_file', status: 'running', detail: 'README.md' });
    live = agentLiveStep(live, { kind: 'tool', callId: 'c1', name: 'read_file', status: 'completed', detail: 'README.md' });
    live = agentLiveStep(live, { kind: 'assistant', text: 'the file.' });
    expect(live.turn?.text).toBe('Reading the file.');
    expect(live.turn?.tools).toEqual([{ callId: 'c1', line: 'Read README.md', done: true }]);
    expect(live.finished).toBe(false);
    live = agentLiveStep(live, { kind: 'result', runId: 'run-1', status: 'FINISHED', text: 'Done: added the license.' });
    expect(live.turn?.text).toBe('Done: added the license.');
    expect(live.turn?.streaming).toBe(false);
    expect(live.finished).toBe(true);
    expect(agentRunning(live, 'RUNNING')).toBe(false);
  });

  it('marks a run that ended with an error, and a status that ends a turn', () => {
    const running = agentLiveStep(IDLE_LIVE, { kind: 'assistant', text: 'Hi' });
    expect(agentLiveStep(running, { kind: 'error', message: 'Boom' }).turn?.error).toBe('Boom');
    const ended = agentLiveStep(running, { kind: 'status', status: 'FINISHED', runId: null });
    expect(ended.finished).toBe(true);
    expect(ended.turn?.streaming).toBe(false);
    expect(agentLiveStep(IDLE_LIVE, { kind: 'status', status: 'FINISHED', runId: null }).finished).toBe(false);
  });
});
