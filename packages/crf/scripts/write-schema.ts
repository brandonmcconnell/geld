import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crfJsonSchemaText } from '../src/json-schema';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'crf-v0.schema.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, crfJsonSchemaText());
console.log(`wrote ${target}`);
