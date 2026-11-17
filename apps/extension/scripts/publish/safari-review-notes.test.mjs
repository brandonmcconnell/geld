import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./safari-review-notes.mjs', import.meta.url));
const template = fileURLToPath(new URL('../../store/safari-review-notes.txt', import.meta.url));

const submission = { SAFARI_REVIEW_VERSION: '0.1.4308', SAFARI_REVIEW_BUILD: '4308' };
const recording = {
  SAFARI_REVIEW_VIDEO_URL: 'https://example.test/geld.mov',
  SAFARI_REVIEW_VIDEO_VERSION: '0.1.2 (build 183)',
  SAFARI_REVIEW_TEST_DEVICE: '14-inch MacBook Pro (Mac17,2), Apple M3, macOS 27.0.1 (26A434), Safari 27.0.1',
};

/** Runs the renderer with only the given variables, none inherited from the shell. */
const render = (env, path = template) => {
  const clean = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', env: clean });
  return { status: result.status, out: result.stdout, err: result.stderr };
};

describe('safari-review-notes', () => {
  it('renders the committed template with the version and build and keeps every numbered answer', () => {
    const { status, out } = render(submission);
    assert.equal(status, 0);
    assert.match(out, /This submission is Geld 0\.1\.4308 \(build 4308\)/);
    for (const heading of ['1. Physical-device recording', '2. Purpose and audience', '3. Setup', '4. External services', '5. Regional differences', '6. Regulated services']) {
      assert.ok(out.includes(heading), `missing "${heading}"`);
    }
    assert.doesNotMatch(out, /\{\{[A-Z_]+\}\}/);
  });

  it('with no recording configured, points App Review at the recording its first review was given', () => {
    const { out } = render(submission);
    assert.match(out, /geld-safari-0\.1\.2-build163-narrated-tight\.mov/);
    assert.match(out, /App Review messages/);
    assert.doesNotMatch(out, /Recording: https/);
  });

  it('with the recording configured, cites its URL, device and the version it shows', () => {
    const { status, out } = render({ ...submission, ...recording });
    assert.equal(status, 0);
    assert.match(out, /Recording: https:\/\/example\.test\/geld\.mov/);
    assert.match(out, /attached under App Review Information/);
    assert.match(out, /Captured on 14-inch MacBook Pro \(Mac17,2\)[^\n]*showing Geld 0\.1\.2 \(build 183\)/);
    assert.doesNotMatch(out, /narrated-tight\.mov/);
  });

  it('never gates on the recorded version: a recording of an older version serves a newer submission', () => {
    const { status, out } = render({ ...submission, ...recording, SAFARI_REVIEW_VERSION: '0.2.9000', SAFARI_REVIEW_BUILD: '9000' });
    assert.equal(status, 0);
    assert.match(out, /showing Geld 0\.1\.2 \(build 183\)/);
    assert.match(out, /This submission is Geld 0\.2\.9000 \(build 9000\)/);
  });

  it('refuses a partial set of the recording variables', () => {
    for (const name of Object.keys(recording)) {
      const partial = { ...submission, [name]: recording[name] };
      const result = render(partial);
      assert.notEqual(result.status, 0, `accepted ${name} alone`);
      assert.match(result.err, /together, or none of them/);
    }
    const { status, err } = render({ ...submission, ...recording, SAFARI_REVIEW_TEST_DEVICE: '  ' });
    assert.notEqual(status, 0);
    assert.match(err, /together, or none of them/);
  });

  it('refuses a submission with no version or build', () => {
    assert.match(render({ SAFARI_REVIEW_VERSION: '0.1.4308' }).err, /SAFARI_REVIEW_VERSION and SAFARI_REVIEW_BUILD are required/);
    assert.match(render({ SAFARI_REVIEW_BUILD: '4308' }).err, /SAFARI_REVIEW_VERSION and SAFARI_REVIEW_BUILD are required/);
  });

  it("refuses a template placeholder it cannot fill, so a renamed field never reaches App Review as '{{…}}'", () => {
    const dir = mkdtempSync(join(tmpdir(), 'geld-notes-'));
    const path = join(dir, 'notes.txt');
    writeFileSync(path, 'Geld {{VERSION}} shows {{VIDEO_VERSION}}.\n');
    const { status, err } = render(submission, path);
    assert.notEqual(status, 0);
    assert.match(err, /Unresolved review-note placeholders: \{\{VIDEO_VERSION\}\}/);
  });

  it("stays under App Store Connect's 4,000-character limit, with and without the recording, and refuses notes over it", () => {
    for (const env of [submission, { ...submission, ...recording }]) {
      assert.ok([...render(env).out].length <= 4000);
    }
    const dir = mkdtempSync(join(tmpdir(), 'geld-notes-'));
    const path = join(dir, 'notes.txt');
    writeFileSync(path, `${'x'.repeat(4001)}\n`);
    const { status, err } = render(submission, path);
    assert.notEqual(status, 0);
    assert.match(err, /at most 4000/);
  });
});
