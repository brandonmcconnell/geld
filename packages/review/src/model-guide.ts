/**
 * What Geld can say about a gateway's models beyond what the gateway lists:
 * which few it recommends for the digest's writing (consolidating findings,
 * a TL;DR, a proposed fix - careful prose over a few hundred tokens, many
 * times a day), how a variant suffix changes a model, and a rough tier for
 * intelligence and speed per family. Gateways list none of that, and the
 * benchmark sources sit behind API keys, so this is a bundled, hand-kept
 * table: opinion, labelled as such in the picker, refreshed with releases.
 *
 * Ids are matched on their tail (after the maker's prefix), since gateways
 * spell the prefix differently: `zai/` on Vercel is `z-ai/` on OpenRouter,
 * `spacexai/` is `x-ai/`.
 */

export type Tier = 1 | 2 | 3;

export interface ModelGuide {
  /** The id's tail, exactly (no variant suffix). */
  readonly tail: string;
  readonly title: string;
  readonly why: string;
}

/** In order of preference; the picker shows those the gateway actually has. */
export const RECOMMENDED_MODELS: readonly ModelGuide[] = [
  { tail: 'claude-sonnet-5', title: 'Claude Sonnet 5', why: 'The default pick: careful, concise prose at a mid price; Opus and Fable are more than this work needs.' },
  { tail: 'gpt-5.6-sol', title: 'GPT-5.6 Sol', why: 'OpenAI’s flagship: strong at reading many comments at once and keeping every id straight.' },
  { tail: 'grok-4.6', title: 'Grok 4.6', why: 'Fast for its class and cheaper than Sonnet on output; good at long threads.' },
  { tail: 'glm-5.3', title: 'GLM 5.3', why: 'Open-weights model close to the frontier at a third of Sonnet’s price.' },
  { tail: 'glm-5.3-flash', title: 'GLM 5.3 Flash', why: 'The budget pick: a tenth of GLM 5.3’s price, quick, and good enough for titles and TL;DRs.' },
];

export interface VariantHint {
  readonly kind: 'batch' | 'fast' | 'flashx' | 'small' | 'pro' | 'free' | 'preview' | 'coding' | 'thinking' | 'other';
  readonly note: string;
}

const VARIANTS: ReadonlyArray<readonly [RegExp, VariantHint]> = [
  [/[:-]batch$/i, { kind: 'batch', note: 'Batch queue: answers come back in minutes to hours at about half price. Not for a page you are looking at.' }],
  [/-flashx$/i, { kind: 'flashx', note: 'FlashX: the Flash model served on faster hardware, about 2.5× Flash’s price.' }],
  [/-fast$/i, { kind: 'fast', note: 'Fast tier: the same model served with priority, about twice the price.' }],
  [/-(pro|max)$/i, { kind: 'pro', note: 'Pro: extra compute per answer. Slower and several times the price; more than this work needs.' }],
  [/-(flash|mini|nano|lite|haiku|air|small|turbo)(-|$)/i, { kind: 'small', note: 'Small sibling: much quicker and cheaper, less careful with detail.' }],
  [/:free$/i, { kind: 'free', note: 'Free tier: rate-limited and may queue.' }],
  [/-(preview|exp|beta)(-|$)|-\d{4}$|-\d{8}$/i, { kind: 'preview', note: 'Preview or dated snapshot: may change or disappear.' }],
  [/-(codex|code|coder|build)(-|$)/i, { kind: 'coding', note: 'Tuned for coding agents rather than prose.' }],
  [/-(thinking|reasoning|non-reasoning|multi-agent|contributor|highspeed|terminus|vision|image)(-|$)/i, { kind: 'thinking', note: 'A specialised serving of the base model.' }],
];

/** The id's tail after the maker's prefix. */
export function modelTail(id: string): string {
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
}

/** What a variant suffix means, when the id has one; null for a family's plain model. */
export function variantOf(id: string): VariantHint | null {
  const tail = modelTail(id);
  for (const [pattern, hint] of VARIANTS) if (pattern.test(tail)) return hint;
  return null;
}

export function recommendationFor(id: string): ModelGuide | null {
  const tail = modelTail(id).toLowerCase();
  return RECOMMENDED_MODELS.find((guide) => guide.tail === tail) ?? null;
}

export interface ModelTiers {
  readonly intelligence: Tier;
  readonly speed: Tier;
}

/** Family tiers, by the id's tail. Order matters: the first match wins, so the more specific rows come first. */
const FAMILY_TIERS: ReadonlyArray<readonly [RegExp, ModelTiers]> = [
  [/^claude-(fable|opus)/i, { intelligence: 3, speed: 1 }],
  [/^claude-sonnet-(5|4\.[6-9])/i, { intelligence: 3, speed: 2 }],
  [/^claude-sonnet/i, { intelligence: 2, speed: 2 }],
  [/^claude-(haiku|3-haiku)/i, { intelligence: 2, speed: 3 }],
  [/^gpt-5\.[5-9]-(sol|terra|luna)-pro/i, { intelligence: 3, speed: 1 }],
  [/^gpt-5\.[5-9]-(sol|terra|luna)/i, { intelligence: 3, speed: 2 }],
  [/^gpt-5(\.\d+)?-(nano|mini)/i, { intelligence: 2, speed: 3 }],
  [/^gpt-5(\.\d+)?-pro/i, { intelligence: 3, speed: 1 }],
  [/^gpt-5/i, { intelligence: 3, speed: 2 }],
  [/^grok-4\.[5-9]/i, { intelligence: 3, speed: 2 }],
  [/^grok/i, { intelligence: 2, speed: 2 }],
  [/^glm-5\.[2-9]-(flash|flashx)/i, { intelligence: 2, speed: 3 }],
  [/^glm-5\.[2-9]/i, { intelligence: 3, speed: 2 }],
  [/^glm-5/i, { intelligence: 2, speed: 2 }],
  [/^glm/i, { intelligence: 2, speed: 2 }],
  [/^gemini-3\.\d+-pro|^gemini-3-pro/i, { intelligence: 3, speed: 2 }],
  [/^gemini-.*flash-lite/i, { intelligence: 1, speed: 3 }],
  [/^gemini-.*flash/i, { intelligence: 2, speed: 3 }],
  [/^gemini-2\.5-pro/i, { intelligence: 3, speed: 2 }],
  [/^deepseek-v4-pro/i, { intelligence: 3, speed: 2 }],
  [/^deepseek-v4/i, { intelligence: 2, speed: 3 }],
  [/^deepseek/i, { intelligence: 2, speed: 2 }],
  [/^kimi-k3/i, { intelligence: 3, speed: 2 }],
  [/^kimi/i, { intelligence: 2, speed: 2 }],
  [/^qwen3\.5-plus/i, { intelligence: 2, speed: 2 }],
  [/^qwen.*flash/i, { intelligence: 2, speed: 3 }],
  [/^muse-spark-1\.[3-9]/i, { intelligence: 3, speed: 2 }],
  [/^muse/i, { intelligence: 2, speed: 2 }],
];

/** Geld's rough tiers for a model, or null when the family is not in the table. A fast tier lifts speed; a batch queue floors it. */
export function tiersFor(id: string): ModelTiers | null {
  const tail = modelTail(id).replace(/:batch$|-batch$|:free$/i, '');
  const base = FAMILY_TIERS.find(([pattern]) => pattern.test(tail))?.[1];
  if (base === undefined) return null;
  const variant = variantOf(id);
  if (variant?.kind === 'batch') return { intelligence: base.intelligence, speed: 1 };
  if (variant?.kind === 'fast' || variant?.kind === 'flashx') return { intelligence: base.intelligence, speed: base.speed === 3 ? 3 : ((base.speed + 1) as Tier) };
  if (variant?.kind === 'pro') return { intelligence: base.intelligence, speed: 1 };
  return base;
}

/** Sort rank in a picker: recommended first, then a family's plain models, then variants. */
export function pickerRank(id: string): 0 | 1 | 2 {
  if (recommendationFor(id) !== null) return 0;
  return variantOf(id) === null ? 1 : 2;
}
