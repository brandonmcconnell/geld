export interface GuidePolicy {
  readonly trigger: 'click' | 'created' | 'push';
  readonly drafts: boolean;
  readonly override: boolean;
  readonly locked: boolean;
}
export const DEFAULT_GUIDE_POLICY: GuidePolicy = { trigger: 'click', drafts: false, override: false, locked: false };
export function effectiveGuidePolicy(levels: readonly GuidePolicy[]): GuidePolicy {
  let current = DEFAULT_GUIDE_POLICY;
  for (const policy of levels) {
    if (current.locked) break;
    if (policy.override) current = policy;
    else if (policy.locked) current = { ...current, locked: true };
  }
  return current;
}
export function shouldGenerateGuide(policy: GuidePolicy, event: 'click' | 'created' | 'push' | 'force_push', state: 'open' | 'closed' | 'merged', draft: boolean): boolean {
  if (state !== 'open' || (draft && !policy.drafts)) return false;
  if (event === 'click') return true;
  return policy.trigger === 'push' || (policy.trigger === 'created' && event === 'created');
}
export type FeatureFlag = 'projects' | 'roadmaps';
export function featureEnabled(feature: FeatureFlag, snapshot: Readonly<Record<string, boolean>> = {}): boolean {
  return snapshot[feature] === true;
}
