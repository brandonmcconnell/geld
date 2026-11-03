import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { randomBytes, createHash } from 'node:crypto';
import { EVIDENCE_FILES, EVIDENCE_LIMITS, emitProviderEvidence, readEvidenceFile, summarizeProviderEvidence } from './provider-evidence.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const report = () => ({ schema: 1, startedAt: '2026-11-03T07:00:00.000Z', cases: [{ name: 'gitlab-overview-digest', status: 'failed', error: 'Original conversation nodes and content must be retained: PRIVATE_CANARY', url: 'https://PRIVATE_CANARY/' }], private: 'PRIVATE_CANARY' });
async function withDirectory(fn) { const directory = await mkdtemp(join(tmpdir(), 'geld-evidence-'));try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); } }

test('fixed artifact bytes round trip through bounded gzip/base64 log chunks with exact hashes', async () => withDirectory(async directory => {
  const raw = Buffer.concat([Buffer.from('<!DOCTYPE html><p>Public retained body</p>'), randomBytes(20_000)]);
  await writeFile(join(directory, 'report.json'), JSON.stringify(report()));
  await writeFile(join(directory, EVIDENCE_FILES[0]), raw);
  const lines = [];await emitProviderEvidence({ directory, write: line => lines.push(line) });
  const metadata = JSON.parse(lines.find(line => line.startsWith('GELD_EVIDENCE_META ')).split('GELD_EVIDENCE_META ')[1]);
  const chunks = lines.filter(line => line.startsWith('GELD_EVIDENCE_CHUNK ')).map(line => JSON.parse(line.split('GELD_EVIDENCE_CHUNK ')[1]));
  assert.equal(metadata.file, EVIDENCE_FILES[0]);assert.equal(metadata.rawSha256, sha(raw));
  assert.ok(chunks.length > 1);assert.ok(chunks.every(chunk => chunk.data.length <= EVIDENCE_LIMITS.chunk));
  const gzip = Buffer.from(chunks.sort((a, b) => a.index - b.index).map(chunk => chunk.data).join(''), 'base64');
  assert.equal(metadata.gzipSha256, sha(gzip));assert.deepEqual(gunzipSync(gzip), raw);
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_CANARY|https:\/\//);
  assert.equal(JSON.parse(lines.at(-1).split('GELD_EVIDENCE_DONE ')[1]).browserStarted, false);
}));

test('summary only exports known case/status/count/time fields, never raw errors or arbitrary fields', () => {
  const value = report();value.cases.push({ name: 'PRIVATE_CANARY', status: 'secret' });
  const result = summarizeProviderEvidence(value, Buffer.from('{}'));
  assert.equal(result.cases.length, 1);assert.equal(result.cases[0].errorKind, 'conversation_custody');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY|https:/);
});

test('actual disclosure timeout with zero custody mismatches remains a failed disclosure rather than a custody failure', () => {
  const value = report();
  value.cases = [{ name: 'bitbucket-ui-continuity', status: 'failed',
    error: 'Error: Real custom dashboard disclosure changes its body timed out. Last value: {"sameOriginals":true,"custody":{"bodyMismatches":0}}',
    dashboardUi: { baseline: { custody: { identityMismatches: 0, parentMismatches: 0, idMismatches: 0, bodyMismatches: 0, payloadOrderMismatches: 0, unqualifiedPayloads: 0 } } } }];
  const result = summarizeProviderEvidence(value, Buffer.from('{}')).cases[0];
  assert.equal(result.errorKind, 'dashboard_disclosure');assert.equal(result.status, 'failed');
  value.cases[0].error = 'An unrelated request body failed';
  assert.equal(summarizeProviderEvidence(value, Buffer.from('{}')).cases[0].errorKind, 'other');
  value.cases[0].dashboardUi.baseline.custody.bodyMismatches = 1;
  assert.equal(summarizeProviderEvidence(value, Buffer.from('{}')).cases[0].errorKind, 'conversation_custody');
  value.cases[0].holdReason = 'provider_http429';
  assert.equal(summarizeProviderEvidence(value, Buffer.from('{}')).cases[0].errorKind, 'http429');
});

test('Bitbucket dashboard captures use exact runner filenames and retain hashes without broadening the path allowlist', async () => withDirectory(async directory => {
  assert.deepEqual(EVIDENCE_FILES.slice(0, 4), [
    'gitlab-dashboard-native-hidden.html', 'gitlab-dashboard-native-hidden.png',
    'gitlab-overview-digest-failed.html', 'gitlab-overview-digest-failed.png',
  ]);
  const expected = [
    'bitbucket-dashboard-native-hidden.html', 'bitbucket-dashboard-native-hidden.png',
    'bitbucket-dashboard-native-dark.html', 'bitbucket-dashboard-native-dark.png',
    'bitbucket-ui-continuity-failed.html', 'bitbucket-ui-continuity-failed.png',
    'bitbucket-comment-digest-failed.html', 'bitbucket-comment-digest-failed.png',
  ];
  assert.deepEqual(EVIDENCE_FILES.slice(4), expected);
  await writeFile(join(directory, 'report.json'), JSON.stringify(report()));
  const payloads = new Map(expected.map((file, index) => [file, Buffer.from(`Retained public capture ${index}`)]));
  for (const [file, bytes] of payloads) await writeFile(join(directory, file), bytes);
  const lines = [];await emitProviderEvidence({ directory, write: line => lines.push(line) });
  const records = prefix => lines.filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
  const metadata = records('GELD_EVIDENCE_META '), chunks = records('GELD_EVIDENCE_CHUNK ');
  assert.deepEqual(metadata.map(item => item.file), expected);
  for (const item of metadata) {
    const compressed = Buffer.from(chunks.filter(chunk => chunk.file === item.file).sort((a, b) => a.index - b.index).map(chunk => chunk.data).join(''), 'base64');
    assert.equal(item.rawSha256, sha(payloads.get(item.file)));assert.equal(item.gzipSha256, sha(compressed));
    assert.deepEqual(gunzipSync(compressed), payloads.get(item.file));
  }
  assert.deepEqual(records('GELD_EVIDENCE_DONE ')[0], { files: 8, gzipBytes: metadata.reduce((total, item) => total + item.gzipBytes, 0), providerRequests: 0, browserStarted: false });
  for (const name of ['bitbucket-dashboard-native-hidden-extra.html', 'bitbucket-dashboard-native-dark.svg', 'bitbucket-unlisted-failed.png', '../bitbucket-dashboard-native-hidden.html']) {
    await assert.rejects(readEvidenceFile(directory, name, 100), { code: 'EVIDENCE_PATH' });
  }
}));

test('Bitbucket UI summaries retain fixed status and custody fields without raw report payloads', () => {
  const value = report();
  value.cases.push({ name: 'bitbucket-ui-continuity', status: 'passed', dashboardUi: { baseline: { custody: { bodyMismatches: 0, private: 'PRIVATE_CANARY' } } }, private: 'PRIVATE_CANARY' });
  value.cases.push({ name: 'bitbucket-comment-digest', status: 'failed', error: 'Original conversation PRIVATE_CANARY', dashboardUi: { baseline: { custody: { bodyMismatches: 1 } } } });
  const result = summarizeProviderEvidence(value, Buffer.from('{}'));
  assert.deepEqual(result.cases.map(item => [item.name, item.status, item.custody.bodyMismatches]), [
    ['gitlab-overview-digest', 'failed', null], ['bitbucket-ui-continuity', 'passed', 0], ['bitbucket-comment-digest', 'failed', 1],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY|https:/);
});

test('paths and symlinks cannot read outside the fixed artifact directory', async () => withDirectory(async directory => {
  await assert.rejects(readEvidenceFile(directory, '../report.json', 10), { code: 'EVIDENCE_PATH' });
  await assert.rejects(readEvidenceFile(directory, '/etc/passwd', 10), { code: 'EVIDENCE_PATH' });
  await writeFile(join(directory, 'private'), 'PRIVATE_CANARY');await symlink(join(directory, 'private'), join(directory, EVIDENCE_FILES[0]));
  await assert.rejects(readEvidenceFile(directory, EVIDENCE_FILES[0], 100), { code: 'EVIDENCE_PATH' });
  await mkdir(join(directory, EVIDENCE_FILES[1]));await assert.rejects(readEvidenceFile(directory, EVIDENCE_FILES[1], 100), { code: 'EVIDENCE_PATH' });
}));

test('raw reads accept exact size but reject the next byte; compressed payloads are independently capped', async () => withDirectory(async directory => {
  await writeFile(join(directory, EVIDENCE_FILES[0]), '1234');assert.equal((await readEvidenceFile(directory, EVIDENCE_FILES[0], 4)).length, 4);
  await assert.rejects(readEvidenceFile(directory, EVIDENCE_FILES[0], 3), { code: 'EVIDENCE_SIZE' });
  await writeFile(join(directory, 'report.json'), JSON.stringify(report()));await writeFile(join(directory, EVIDENCE_FILES[0]), randomBytes(EVIDENCE_LIMITS.gzip + 2000));
  await assert.rejects(emitProviderEvidence({ directory, write() {} }), { code: 'EVIDENCE_COMPRESSED_SIZE' });
}));

test('missing or invalid reports and missing selected evidence fail explicitly', async () => withDirectory(async directory => {
  await assert.rejects(emitProviderEvidence({ directory, write() {} }), { code: 'EVIDENCE_REPORT' });
  await writeFile(join(directory, 'report.json'), '{}');await assert.rejects(emitProviderEvidence({ directory, write() {} }), { code: 'EVIDENCE_REPORT' });
  await writeFile(join(directory, 'report.json'), JSON.stringify(report()));await assert.rejects(emitProviderEvidence({ directory, write() {} }), { code: 'EVIDENCE_FILES_MISSING' });
}));

test('CLI rejects custom arguments and never prints raw filesystem errors or starts provider work', async () => withDirectory(async directory => {
  const result = spawnSync(process.execPath, [resolve('scripts/provider-evidence.mjs'), 'PRIVATE_CANARY'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 1);assert.equal(result.stdout, '');assert.match(result.stderr, /^GELD_EVIDENCE_FAILED EVIDENCE_ARGUMENTS\n$/);
  const noHistory = spawnSync(process.execPath, [resolve('scripts/provider-evidence.mjs')], { cwd: directory, encoding: 'utf8' });
  assert.equal(noHistory.status, 1);assert.match(noHistory.stderr, /^GELD_EVIDENCE_FAILED EVIDENCE_READ\n$/);assert.doesNotMatch(noHistory.stderr, /PRIVATE_CANARY|Error:|stack/);
}));


test('total compressed bytes stay bounded across several individually valid files', async () => withDirectory(async directory => {
  await writeFile(join(directory, 'report.json'), JSON.stringify(report()));
  for (const file of EVIDENCE_FILES) await writeFile(join(directory, file), randomBytes(800_000));
  await assert.rejects(emitProviderEvidence({ directory, write() {} }), { code: 'EVIDENCE_COMPRESSED_SIZE' });
}));

test('valid diagnostic CLI exports only fixed files without reading environment values', async () => withDirectory(async directory => {
  const source = join(directory, '.browser-previous-evidence');await mkdir(source);
  await writeFile(join(source, 'report.json'), JSON.stringify(report()));await writeFile(join(source, EVIDENCE_FILES[0]), '<html>Public captured page</html>');
  const result = spawnSync(process.execPath, [resolve('scripts/provider-evidence.mjs')], { cwd: directory, encoding: 'utf8', env: { ...process.env, PRIVATE_CANARY: 'DO_NOT_PRINT_ENV' } });
  assert.equal(result.status, 0);assert.equal(result.stderr, '');assert.match(result.stdout, /GELD_EVIDENCE_DONE/);assert.doesNotMatch(result.stdout, /PRIVATE_CANARY|DO_NOT_PRINT_ENV/);
}));
