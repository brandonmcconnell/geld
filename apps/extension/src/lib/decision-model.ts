import type { GeldSettings } from '@geld/core';
import { defaultDecisionModel } from '@geld/review';
import type { AiGatewayInfo } from './local-state';

export function gatewayDecisionModel(settings: Pick<GeldSettings, 'aiBaseUrl' | 'aiDecisionModel'>, gateway: AiGatewayInfo | null): string | null {
  const listed = gateway !== null && gateway.baseUrl === settings.aiBaseUrl ? gateway.models.map((id) => gateway.details?.[id] ?? { id }) : [];
  const automatic = defaultDecisionModel(settings.aiBaseUrl, listed);
  return automatic !== null && settings.aiDecisionModel !== '' ? settings.aiDecisionModel : automatic;
}
