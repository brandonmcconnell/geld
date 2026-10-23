import type { StandardSchemaV1 } from '@standard-schema/spec';
import { CRF_VERSION, CrfBlock } from './schema';

export const MARKER_PREFIX = `crf:${CRF_VERSION}`;

// Each HTML comment whole, to its own `-->` (the JSON cannot contain one: writers escape `<` and `>`), so a block whose
// JSON is unfinished ends where its comment does and never runs on into the next block.
const BLOCK_PATTERN = /<!--\s*crf:(v\d+)\s+([\s\S]*?)\s*-->/g;

interface FoundBlock {
  readonly version: string;
  readonly json: string;
}

/** An open fence: its marker, whether it stands in a quote, and the column its content starts at (a list item's). */
interface Fence {
  readonly char: string;
  readonly length: number;
  readonly quoted: boolean;
  readonly indent: number;
  /** Opened on a list marker's line: a less indented line ends the item, and the fence with it. */
  readonly listed: boolean;
}

const QUOTE = /^ {0,3}> ?/;
const OPENER = /^( *)((?:[-*+]|\d{1,9}[.)]) +)?( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * The Markdown with every fenced code block (``` or ~~~) blanked out: an example there is not a claim. CommonMark's
 * rules as far as a comment needs them: a fence may stand in a quote or a list item, closes with a marker at most three
 * spaces in from where its content starts, and ends unclosed when its quote or list item does.
 */
function outsideFences(markdown: string): string {
  let fence: Fence | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const quoted = QUOTE.test(line);
      const inner = quoted ? line.replace(QUOTE, '') : line;
      if (fence !== null) {
        // A `>` is the quote's marker only for a fence opened in a quote: inside any other fence it is content.
        const view = fence.quoted ? inner : line;
        const lead = /^ */.exec(view)?.[0].length ?? 0;
        const ended = (fence.quoted && !quoted) || (fence.listed && view.trim() !== '' && lead < fence.indent);
        if (!ended) {
          const closer = /^( *)(`{3,}|~{3,})\s*$/.exec(view);
          const marker = closer?.[2];
          if (closer !== null && marker !== undefined && marker[0] === fence.char && marker.length >= fence.length && (closer[1]?.length ?? 0) - fence.indent <= 3) fence = null;
          return '';
        }
        fence = null;
      }
      const found = OPENER.exec(inner);
      const marker = found?.[4];
      if (found === null || marker === undefined || (marker[0] === '`' && (found[5] ?? '').includes('`'))) return line;
      const lead = found[1]?.length ?? 0;
      const item = found[2] ?? '';
      fence = { char: marker[0] ?? '`', length: marker.length, quoted, indent: lead + item.length, listed: item !== '' };
      return '';
    })
    .join('\n');
}

function findBlocks(markdown: string): FoundBlock[] {
  const found: FoundBlock[] = [];
  for (const match of outsideFences(markdown).matchAll(BLOCK_PATTERN)) {
    const [, version, json] = match;
    if (version !== undefined && json !== undefined) found.push({ version, json });
  }
  return found;
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export interface RawBlock {
  readonly version: string;
  readonly value: unknown;
}

/** Every `<!-- crf:vN {…} -->` in a comment's raw Markdown, in order, JSON-parsed but not validated. Malformed JSON is skipped. */
export function extractBlocks(markdown: string): RawBlock[] {
  return findBlocks(markdown).flatMap(({ version, json }) => {
    const value = parseJson(json);
    return value === undefined ? [] : [{ version, value }];
  });
}

/**
 * The block as the HTML comment a bot appends to its comment, on a line of its own.
 * `<` and `>` become `\u003c` and `\u003e`: still the same JSON, and a `-->` inside a title cannot end the comment early.
 */
export function encodeBlock(block: CrfBlock): string {
  // Validated, but the writer's own object is what is written: parsing strips the fields a bot may add of its own.
  CrfBlock.parse(block);
  const json = JSON.stringify(block).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<!-- ${MARKER_PREFIX} ${json} -->`;
}

/** The last block of this version, chosen before it is parsed: a malformed last block makes no claim rather than revive an earlier one. */
function lastOfThisVersion(markdown: string): unknown {
  const last = findBlocks(markdown)
    .filter((block) => block.version === CRF_VERSION)
    .at(-1);
  return last === undefined ? undefined : parseJson(last.json);
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
