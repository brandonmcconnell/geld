import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadMeasurementCode(): Promise<string | null> {
  for (const path of [
    join(process.cwd(), 'node_modules/posthog-js/dist/array.js'),
    join(process.cwd(), 'apps/dashboard/node_modules/posthog-js/dist/array.js'),
  ]) {
    try {
      return await readFile(/*turbopackIgnore: true*/ path, 'utf8');
    } catch {
      /* Standalone and workspace layouts differ. */
    }
  }
  return null;
}
