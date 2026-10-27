import { describe, expect, it } from 'vitest';
import { pickerRank, recommendationFor, RECOMMENDED_MODELS, tiersFor, variantOf } from './model-guide';

describe('model guide', () => {
  it('recommends by id tail, whichever prefix the gateway uses, and never a variant', () => {
    expect(recommendationFor('anthropic/claude-sonnet-5')?.title).toBe('Claude Sonnet 5');
    expect(recommendationFor('zai/glm-5.3')?.title).toBe('GLM 5.3');
    expect(recommendationFor('z-ai/glm-5.3')?.title).toBe('GLM 5.3');
    expect(recommendationFor('x-ai/grok-4.6')).not.toBeNull();
    expect(recommendationFor('anthropic/claude-sonnet-5:batch')).toBeNull();
    expect(recommendationFor('openai/gpt-5.6-sol-fast')).toBeNull();
    expect(RECOMMENDED_MODELS.every((guide) => variantOf(guide.tail) === null || guide.tail === 'glm-5.3-flash')).toBe(true);
  });

  it('names what a variant suffix means', () => {
    expect(variantOf('z-ai/glm-5.3:batch')?.kind).toBe('batch');
    expect(variantOf('zai/glm-5.3-flashx')?.kind).toBe('flashx');
    expect(variantOf('zai/glm-5.3-flash')?.kind).toBe('small');
    expect(variantOf('openai/gpt-5.6-sol-fast')?.kind).toBe('fast');
    expect(variantOf('openai/gpt-5.6-sol-pro')?.kind).toBe('pro');
    expect(variantOf('google/gemini-3.1-pro-preview')?.kind).toBe('preview');
    expect(variantOf('openai/gpt-5.3-codex')?.kind).toBe('coding');
    expect(variantOf('anthropic/claude-sonnet-5')).toBeNull();
    expect(variantOf('spacexai/grok-4.6')).toBeNull();
  });

  it('gives family tiers, lifted by fast tiers and floored by batch', () => {
    expect(tiersFor('anthropic/claude-sonnet-5')).toEqual({ intelligence: 3, speed: 2 });
    expect(tiersFor('zai/glm-5.3')).toEqual({ intelligence: 3, speed: 2 });
    expect(tiersFor('zai/glm-5.3-flash')).toEqual({ intelligence: 2, speed: 3 });
    expect(tiersFor('zai/glm-5.3-fast')).toEqual({ intelligence: 3, speed: 3 });
    expect(tiersFor('z-ai/glm-5.3:batch')).toEqual({ intelligence: 3, speed: 1 });
    expect(tiersFor('anthropic/claude-opus-5')).toEqual({ intelligence: 3, speed: 1 });
    expect(tiersFor('somebody/unheard-of-7b')).toBeNull();
  });

  it('ranks recommended, plain, then variants', () => {
    expect(pickerRank('anthropic/claude-sonnet-5')).toBe(0);
    expect(pickerRank('anthropic/claude-opus-5')).toBe(1);
    expect(pickerRank('anthropic/claude-opus-5-fast')).toBe(2);
  });
});
