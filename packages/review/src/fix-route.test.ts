import { describe, expect, it } from 'vitest';
import type { RouteInput } from './fix-route';
import { needsAgent, parseRouteOutput, ROUTE_BATCH, routeKey, routeRequests, routesFromAnswers, WIDER_AT } from './fix-route';

const pull = { title: 'Skip missing values', description: 'Totals skip projects with no data yet.' };
const input = (id: string): RouteInput => ({ id, title: 'Counts missing values as zero', path: 'src/total.ts', excerpts: ['`total` counts missing values as zero.'], target: { start: 3, end: 3, text: 'use(x);' }, around: '  3> use(x);' });

describe('the check before a fix is drafted', () => {
  it('asks a decision model one yes/no question per finding, a batch per request', () => {
    const inputs = Array.from({ length: ROUTE_BATCH + 1 }, (_, index) => input(`discussion_r${index}`));
    const requests = routeRequests('jev', pull, inputs);
    expect(requests).toHaveLength(2);
    expect(Object.keys(requests[0]?.questions ?? {})).toHaveLength(ROUTE_BATCH);
    expect(requests[1]?.questions[routeKey(`discussion_r${ROUTE_BATCH}`)]).toMatchObject({ type: 'noul' });
    const state = requests[0]?.state;
    expect(state).toMatchObject({ pullRequest: { title: pull.title } });
    const findings: unknown = typeof state === 'object' && state !== null && 'findings' in state ? state.findings : null;
    expect(Array.isArray(findings) ? findings[0] : null).toMatchObject({ id: 'discussion_r0', path: 'src/total.ts', target: { start: 3, end: 3 } });
  });

  it('reads both models into the same route, a reasoning model’s as 0 or 1', () => {
    expect(routesFromAnswers({ [routeKey('a')]: { type: 'noul', noul: 0.7 }, 'lane:b': { type: 'noul', noul: 1 } })).toEqual(new Map([['a', { wider: 0.7, needs: '' }]]));
    const text = JSON.stringify({ routes: [{ id: 'a', scope: 'wider', needs: ' Also change `summarize`. ' }, { id: 'b', scope: 'lines', needs: 'ignored' }, { id: 'a', scope: 'lines', needs: '' }, { id: 'unknown', scope: 'wider', needs: 'x' }] });
    expect(parseRouteOutput(text, ['a', 'b', 'c'])).toEqual(
      new Map([
        ['a', { wider: 1, needs: 'Also change `summarize`.' }],
        ['b', { wider: 0, needs: '' }],
      ]),
    );
    expect(parseRouteOutput('not json', ['a'])).toBeNull();
    expect(parseRouteOutput(JSON.stringify({ routes: [{ id: 'a', scope: 'maybe', needs: '' }] }), ['a'])).toBeNull();
  });

  it('sends a finding to an agent from as likely as not, and drafts one it has no answer for', () => {
    expect(needsAgent({ wider: WIDER_AT, needs: '' })).toBe(true);
    expect(needsAgent({ wider: WIDER_AT - 0.01, needs: '' })).toBe(false);
    expect(needsAgent(undefined)).toBe(false);
  });
});
