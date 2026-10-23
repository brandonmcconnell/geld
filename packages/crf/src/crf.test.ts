import { readFileSync } from 'node:fs';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  EXAMPLE_FINDING,
  EXAMPLE_REFUSAL,
  EXAMPLE_STATUS,
  EXAMPLE_SUMMARY,
  FIXTURES,
  CrfBlock,
  checkConformance,
  encodeBlock,
  extractBlocks,
  parseBlock,
  readBlock,
  crfJsonSchemaText,
} from './index';

const summary = CrfBlock.parse(EXAMPLE_SUMMARY);

describe('schema', () => {
  it('conforms to its own fixtures', async () => {
    expect(await checkConformance(CrfBlock)).toEqual([]);
  });

  it('drops fields it does not know rather than rejecting them', () => {
    const parsed = CrfBlock.parse({ ...EXAMPLE_STATUS, vendor: { anything: true } });
    expect(parsed).not.toHaveProperty('vendor');
  });

  it('shares the finding shape between a summary and a thread comment', () => {
    const fromSummary = summary.kind === 'summary' ? summary.result?.findings?.[0] : undefined;
    const fromThread = CrfBlock.parse(EXAMPLE_FINDING);
    expect(fromThread.kind === 'finding' ? fromThread.finding.id : undefined).toBe(fromSummary?.id);
  });
});

describe('carrier', () => {
  it('round-trips through the HTML comment, including a title holding -->', () => {
    const block = CrfBlock.parse({
      ...EXAMPLE_FINDING,
      finding: { ...EXAMPLE_FINDING.finding, title: 'Closes early --> <script>' },
    });
    const comment = encodeBlock(block);
    expect(comment.indexOf('-->')).toBe(comment.length - 3);
    expect(comment.startsWith('<!-- crf:v0 {')).toBe(true);
    expect(parseBlock(`Some review prose.\n\n${comment}\n`)).toEqual(block);
  });

  it('takes the last block in a comment', () => {
    const body = `${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n…\n${encodeBlock(summary)}`;
    expect(parseBlock(body)?.kind).toBe('summary');
  });

  it('reads no claim from an example inside a fenced code block', () => {
    const example = encodeBlock(summary);
    expect(parseBlock(`How to write one:\n\n\`\`\`html\n${example}\n\`\`\`\n`)).toBeUndefined();
    expect(parseBlock(`~~~~\n${example}\n~~~~`)).toBeUndefined();
    // The real block after an example is still read, and an example after it does not take its place.
    expect(parseBlock(`\`\`\`\n${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\`\`\`\n\n${example}`)?.kind).toBe('summary');
    expect(parseBlock(`${example}\n\n\`\`\`\n${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\`\`\``)?.kind).toBe('summary');
    // A fence inside a list item or a quote closes where it does, and the block after it is still read.
    expect(parseBlock(`- An example:\n  \`\`\`json\n  ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n  \`\`\`\n\n${example}`)?.kind).toBe('summary');
    expect(parseBlock(`- \`\`\`json\n  ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n  \`\`\`\n\n${example}`)?.kind).toBe('summary');
    expect(parseBlock(`> \`\`\`\n> ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n> \`\`\`\n\n${example}`)?.kind).toBe('summary');
    // An unclosed fence ends with its quote or its list item, so the block after either is read.
    expect(parseBlock(`> \`\`\`\n> ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\n${example}`)?.kind).toBe('summary');
    expect(parseBlock(`- \`\`\`\n  ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\n${example}`)?.kind).toBe('summary');
    // A quoted fence shown inside an example is the example's content and closes nothing.
    expect(parseBlock(`\`\`\`\n> \`\`\`\n> ${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\`\`\`\n\n${example}`)?.kind).toBe('summary');
    // A marker four spaces in is the example's content, not its end: the example after it stays an example.
    expect(parseBlock(`${example}\n\n\`\`\`\n    \`\`\`\n${encodeBlock(CrfBlock.parse(EXAMPLE_STATUS))}\n\`\`\``)?.kind).toBe('summary');
  });

  it('keeps the fields a bot adds of its own when it writes the block', () => {
    const own = { ...summary, vendor: { cost: 3 } };
    expect(extractBlocks(encodeBlock(own))[0]?.value).toHaveProperty('vendor', { cost: 3 });
  });

  it('lets a malformed last block make no claim, and never run into the next one', () => {
    // The last block is the claim: an earlier valid one does not come back because the last is broken.
    expect(parseBlock(`${encodeBlock(summary)}\n<!-- crf:v0 {"schema":"crf/v0", broken -->`)).toBeUndefined();
    // An unfinished block ends at its own comment's end, leaving the valid block after it whole.
    expect(parseBlock(`<!-- crf:v0 {"schema":"crf/v0" -->\n${encodeBlock(summary)}`)?.kind).toBe('summary');
  });

  it('makes no claim for malformed or invalid blocks', () => {
    expect(extractBlocks('<!-- crf:v0 {"schema": nope} -->')).toEqual([]);
    expect(parseBlock('<!-- crf:v0 {"schema":"crf/v0","kind":"reply"} -->')).toBeUndefined();
    expect(parseBlock('No block here.')).toBeUndefined();
  });

  it('leaves other bots’ markers alone and reads blocks of other versions without validating them', () => {
    const body = [
      '<!-- codex-review-state:v1 {"code_review":{"status":"completed"}} -->',
      '<!-- crf:v1 {"schema":"crf/v1","kind":"future"} -->',
    ].join('\n');
    expect(extractBlocks(body)).toEqual([{ version: 'v1', value: { schema: 'crf/v1', kind: 'future' } }]);
    expect(parseBlock(body)).toBeUndefined();
  });

  it('reads through any Standard Schema, not only Zod', async () => {
    const refusalsOnly: StandardSchemaV1<unknown, { kind: 'refusal'; code: string }> = {
      '~standard': {
        version: 1,
        vendor: 'hand-written',
        validate: (value) => {
          const parsed = CrfBlock.safeParse(value);
          if (parsed.success && parsed.data.kind === 'refusal') {
            return { value: { kind: 'refusal', code: parsed.data.refusal.code } };
          }
          return { issues: [{ message: 'not a refusal' }] };
        },
      },
    };
    expect(await readBlock(encodeBlock(CrfBlock.parse(EXAMPLE_REFUSAL)), refusalsOnly)).toEqual({ kind: 'refusal', code: 'quota' });
    expect(await readBlock(encodeBlock(summary), refusalsOnly)).toBeUndefined();
    expect(await checkConformance(refusalsOnly)).not.toEqual([]);
  });
});

describe('JSON Schema', () => {
  it('is committed and current (run `pnpm --filter @geld/crf schema` after changing the schema)', () => {
    const committed = readFileSync(new URL('../schema/crf-v0.schema.json', import.meta.url), 'utf8');
    expect(committed).toBe(crfJsonSchemaText());
  });

  it('keeps objects open, as readers ignore unknown fields', () => {
    expect(crfJsonSchemaText()).not.toContain('"additionalProperties": false');
  });

  it('has a fixture for every kind', () => {
    const kinds = new Set(FIXTURES.filter((f) => f.valid).map((f) => CrfBlock.parse(f.value).kind));
    expect([...kinds].sort()).toEqual(['finding', 'refusal', 'reply', 'status', 'summary']);
  });
});
