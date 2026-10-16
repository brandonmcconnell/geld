import type { StandardSchemaV1 } from '@standard-schema/spec';
import { CRF_VERSION, CrfBlock } from './schema';

export const MARKER_PREFIX = `crf:${CRF_VERSION}`;

// The JSON cannot contain a raw `-->` (writers escape `<` and `>`), so the first `}` followed by `-->` ends the block.
const BLOCK_PATTERN = /<!--\s*crf:(v\d+)\s+(\{[\s\S]*?\})\s*-->/g;

export interface RawBlock {
  readonly version: string;
  readonly value: unknown;
}

/** Every `<!-- crf:vN {…} -->` in a comment's raw Markdown, in order, JSON-parsed but not validated. Malformed JSON is skipped. */
export function extractBlocks(markdown: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  for (const match of markdown.matchAll(BLOCK_PATTERN)) {
    const [, version, json] = match;
    if (version === undefined || json === undefined) continue;
    try {
      blocks.push({ version, value: JSON.parse(json) });
    } catch {
      continue;
    }
  }
  return blocks;
}

/**
 * The block as the HTML comment a bot appends to its comment, on a line of its own.
 * `<` and `>` become `\u003c` and `\u003e`: still the same JSON, and a `-->` inside a title cannot end the comment early.
 */
export function encodeBlock(block: CrfBlock): string {
  const json = JSON.stringify(CrfBlock.parse(block)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<!-- ${MARKER_PREFIX} ${json} -->`;
}

function lastOfThisVersion(markdown: string): unknown {
  return extractBlocks(markdown)
    .filter((block) => block.version === CRF_VERSION)
    .at(-1)?.value;
}

/** The comment's block, validated against this package's schema. The last block wins; an invalid one makes no claim. */
export function parseBlock(markdown: string): CrfBlock | undefined {
  const value = lastOfThisVersion(markdown);
  if (value === undefined) return undefined;
  const result = CrfBlock.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Same as `parseBlock`, validated by any Standard Schema: this package's, or one written in Valibot, ArkType or another library. */
export async function readBlock<S extends StandardSchemaV1>(
  markdown: string,
  schema: S,
): Promise<StandardSchemaV1.InferOutput<S> | undefined> {
  const value = lastOfThisVersion(markdown);
  if (value === undefined) return undefined;
  const result = await schema['~standard'].validate(value);
  return result.issues ? undefined : result.value;
}
