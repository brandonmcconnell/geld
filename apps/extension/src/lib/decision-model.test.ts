import { describe, expect, it } from 'vitest';
import { gatewayDecisionModel } from './decision-model';
import type { AiGatewayInfo } from './local-state';

const gateway: AiGatewayInfo = { baseUrl: 'https://gw.example.com', models: ['acme/decide-1', 'acme/decide-2'], details: { 'acme/decide-1': { id: 'acme/decide-1', type: 'decision' }, 'acme/decide-2': { id: 'acme/decide-2', type: 'decision' } }, jevModel: null, checkedAt: '2026-11-09T00:00:00Z' };

describe('shared gateway decision model', () => {
  it('uses the selected decision model on a gateway that advertises decision support', () => {
    expect(gatewayDecisionModel({ aiBaseUrl: gateway.baseUrl, aiDecisionModel: 'acme/decide-2' }, gateway)).toBe('acme/decide-2');
    expect(gatewayDecisionModel({ aiBaseUrl: gateway.baseUrl, aiDecisionModel: '' }, gateway)).toBe('acme/decide-1');
  });
  it('does not apply another gateway’s metadata or a stale selected model to an unsupported endpoint', () => {
    expect(gatewayDecisionModel({ aiBaseUrl: 'https://other.example.com', aiDecisionModel: 'acme/decide-2' }, gateway)).toBeNull();
  });
  it('retains the built-in decision route when no model list has been read', () => {
    expect(gatewayDecisionModel({ aiBaseUrl: 'https://ai-gateway.vercel.sh', aiDecisionModel: '' }, null)).toBe('typesafe-ai/jev');
  });
});
