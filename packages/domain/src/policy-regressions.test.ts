import { describe, expect, it } from 'vitest';
import { canSpend } from './billing';
import { DEFAULT_GUIDE_POLICY, effectiveGuidePolicy, shouldGenerateGuide } from './guides';

describe('inherited policy boundaries', () => {
  it('locks inherited defaults even when the parent does not override its own values', () => {
    const policy = effectiveGuidePolicy([
      { ...DEFAULT_GUIDE_POLICY, locked: true },
      { ...DEFAULT_GUIDE_POLICY, override: true, trigger: 'push', drafts: true },
    ]);
    expect(policy).toEqual({ ...DEFAULT_GUIDE_POLICY, locked: true });
    expect(shouldGenerateGuide(policy, 'push', 'open', false)).toBe(false);
    expect(shouldGenerateGuide(policy, 'click', 'open', true)).toBe(false);
    const inherited = effectiveGuidePolicy([
      { ...DEFAULT_GUIDE_POLICY, override: true, trigger: 'created' },
      { ...DEFAULT_GUIDE_POLICY, locked: true },
      { ...DEFAULT_GUIDE_POLICY, override: true, trigger: 'push' },
    ]);
    expect(inherited.trigger).toBe('created');
    expect(inherited.locked).toBe(true);
  });
  it('lets newly available included credits run after an overage cap is lowered', () => {
    expect(canSpend({ tier: 'starter', seats: 2, used: 45, requested: 1, spentCents: 125, capCents: 0, card: false }))
      .toEqual({ allowed: true, overageCents: 0 });
    expect(canSpend({ tier: 'starter', seats: 2, used: 80, requested: 1, spentCents: 125, capCents: 0, card: true }))
      .toEqual({ allowed: false, reason: 'cap' });
  });
});
