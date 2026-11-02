export type Tier = 'free' | 'starter' | 'team' | 'business' | 'enterprise';
export interface Plan {
  readonly tier: Tier;
  readonly centsPerSeat: number | null;
  readonly creditsPerSeat: number;
  readonly overageCents: number | null;
  readonly maxTeams: number | null;
  readonly maxRepositories: number | null;
}
export const PLANS: readonly Plan[] = [
  { tier: 'free', centsPerSeat: 0, creditsPerSeat: 0, overageCents: null, maxTeams: 1, maxRepositories: null },
  { tier: 'starter', centsPerSeat: 500, creditsPerSeat: 40, overageCents: 25, maxTeams: 3, maxRepositories: 10 },
  { tier: 'team', centsPerSeat: 1000, creditsPerSeat: 100, overageCents: 20, maxTeams: null, maxRepositories: null },
  { tier: 'business', centsPerSeat: 1600, creditsPerSeat: 200, overageCents: 15, maxTeams: null, maxRepositories: null },
  { tier: 'enterprise', centsPerSeat: null, creditsPerSeat: 0, overageCents: null, maxTeams: null, maxRepositories: null },
];
export function guideCredits(changedLines: number, replanAfterPush: boolean): number {
  if (!Number.isSafeInteger(changedLines) || changedLines < 0) throw new Error('Invalid changed line count');
  return replanAfterPush ? 1 : changedLines > 1500 ? 3 : 1;
}
export function planFor(tier: Tier): Plan {
  const plan = PLANS.find((candidate) => candidate.tier === tier);
  if (!plan) throw new Error('Unknown plan');
  return plan;
}
export type SpendDecision = { readonly allowed: true; readonly overageCents: number } | { readonly allowed: false; readonly reason: 'upgrade' | 'cap' | 'card' | 'quote' };
export function canSpend(input: { readonly tier: Tier; readonly seats: number; readonly used: number; readonly requested: number; readonly capCents: number; readonly spentCents: number; readonly card: boolean;readonly negotiated?:{readonly included:number;readonly overageCents:number} }): SpendDecision {
  if (![input.seats, input.used, input.requested, input.capCents, input.spentCents].every((value) => Number.isSafeInteger(value) && value >= 0) || input.requested < 1 || input.seats < 1) return { allowed: false, reason: 'cap' };
  const plan = planFor(input.tier);
  if (input.tier === 'free') return { allowed: false, reason: 'upgrade' };
  if(input.tier==='enterprise'&&(!input.negotiated||![input.negotiated.included,input.negotiated.overageCents].every(n=>Number.isSafeInteger(n)&&n>=0)))return {allowed:false,reason:'quote'};
  const included = input.tier==='enterprise' ? input.negotiated?.included??0 : plan.creditsPerSeat * input.seats;
  const newOverage = Math.max(0, input.used + input.requested - included) - Math.max(0, input.used - included);
  const cost = newOverage * (input.tier==='enterprise'?input.negotiated?.overageCents??0:plan.overageCents??0);
  if (cost > 0 && !input.card) return { allowed: false, reason: 'card' };
  if (cost > 0 && input.spentCents + cost > input.capCents) return { allowed: false, reason: 'cap' };
  return { allowed: true, overageCents: cost };
}
