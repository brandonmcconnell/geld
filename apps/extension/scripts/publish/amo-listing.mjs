// Set the add-on's summary and description on addons.mozilla.org from the repository.
//
//   node amo-listing.mjs <unpacked-dir> <summary.txt> <description.txt>
//
// Both are the en-US text. A field that already matches is left alone, so a
// re-run changes nothing. AMO's edit page asks for a CAPTCHA on every load in
// automated browsers, which is why the copy lives here rather than in the form.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { readFile } from 'node:fs/promises';

import { addonApi, amo } from './amo-api.mjs';

const [dir, summaryFile, descriptionFile] = process.argv.slice(2);
if (!dir || !summaryFile || !descriptionFile) throw new Error('usage: amo-listing.mjs <unpacked-dir> <summary.txt> <description.txt>');

const wanted = {
  summary: (await readFile(summaryFile, 'utf8')).trim(),
  description: (await readFile(descriptionFile, 'utf8')).trim(),
};
const api = await addonApi(dir);
const current = await amo(`${api}/?lang=en-US`);
const localized = (value) => (typeof value === 'string' ? value : (value?.['en-US'] ?? '')).trim();

const patch = {};
for (const [field, text] of Object.entries(wanted)) {
  if (localized(current[field]) === text) console.log(`${field}: already up to date.`);
  else patch[field] = { 'en-US': text };
}
if (Object.keys(patch).length > 0) {
  await amo(`${api}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  console.log(`Updated ${Object.keys(patch).join(' and ')}.`);
}
