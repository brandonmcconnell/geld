import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/dashboard/design');
const output = path.resolve(process.argv[2] || '/workspace');
fs.mkdirSync(output, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const entries = manifest.entries.map((entry) => {
  assert.match(
    entry.file,
    /^(desktop|mobile|dark)\/[\w-]+\.png$/,
    'Screenshot must stay inside its device directory',
  );
  const image = fs.readFileSync(path.join(root, 'screenshots', entry.file));
  assert.equal(image.subarray(1, 4).toString(), 'PNG', 'Screenshot must contain PNG data');
  return { ...entry, image: 'data:image/png;base64,' + image.toString('base64') };
});
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = html.indexOf('const manifest=');
const end = html.indexOf(';let group=', start);
assert.ok(start >= 0 && end > start, 'Gallery manifest marker exists');
const embedded =
  html.slice(0, start) +
  'const manifest=' +
  JSON.stringify({ ...manifest, entries }).replaceAll('<', '\\u003c') +
  html.slice(end);
const standalone = path.join(output, 'geld-dashboard-preview.html');
fs.writeFileSync(
  standalone,
  embedded.replace('<a href="README.md">Route and state index</a>', 'All images are embedded in this file.'),
);
const archive = path.join(output, 'geld-dashboard-preview.zip');
execFileSync('python3', [
  '-c',
  `
import json, pathlib, sys, zipfile
root=pathlib.Path(sys.argv[1])
manifest=json.loads((root/'manifest.json').read_text())
files=['index.html','manifest.json','README.md']+list(dict.fromkeys('screenshots/'+e['file'] for e in manifest['entries']))
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:
    for name in files: z.write(root/name, 'geld-dashboard-preview/'+name)
with zipfile.ZipFile(sys.argv[2]) as z:
    assert z.testzip() is None
`,
  root,
  archive,
]);
console.log(
  JSON.stringify({ standalone, archive, screenshots: entries.length, zipBytes: fs.statSync(archive).size }),
);
