import { readFile } from 'node:fs/promises';

const [templatePath] = process.argv.slice(2);

if (templatePath === undefined) {
  throw new Error('Usage: node safari-review-notes.mjs <template>');
}

const replacements = {
  VIDEO_URL: process.env.SAFARI_REVIEW_VIDEO_URL,
  TEST_DEVICE: process.env.SAFARI_REVIEW_TEST_DEVICE,
  VERSION: process.env.SAFARI_REVIEW_VERSION,
  BUILD: process.env.SAFARI_REVIEW_BUILD,
};

for (const [name, value] of Object.entries(replacements)) {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing value for review-note placeholder: ${name}`);
  }
}

let notes = await readFile(templatePath, 'utf8');

for (const [name, value] of Object.entries(replacements)) {
  notes = notes.replaceAll(`{{${name}}}`, value);
}

const unresolved = notes.match(/\{\{[A-Z_]+\}\}/g);
if (unresolved !== null) {
  throw new Error(`Unresolved review-note placeholders: ${unresolved.join(', ')}`);
}

process.stdout.write(notes);
