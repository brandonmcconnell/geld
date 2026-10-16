import { z } from 'zod';
import { CRF_SCHEMA, CrfBlock } from './schema';

/**
 * The block as JSON Schema (draft 2020-12), for bots written outside TypeScript. Committed as `schema/crf-v0.schema.json`.
 * Generated from the input side so objects stay open: readers ignore fields they do not know, and so must the JSON Schema.
 */
export function crfJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(CrfBlock, { io: 'input', reused: 'ref' });
  return {
    $schema,
    $id: `https://www.geld.sh/schema/${CRF_SCHEMA.replace('/', '-')}.schema.json`,
    title: 'Common Review Format block',
    ...rest,
  };
}

export function crfJsonSchemaText(): string {
  return `${JSON.stringify(crfJsonSchema(), null, 2)}\n`;
}
