import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { accessEvidenceSummary, exportProviderAccessEvidence } from './provider-access-evidence.mjs';
const report = () => ({ schema: 1, focus: 'provider-access', providerAccessVerification: { status: 'running', clicks: [{ provider: 'gitlab', pointerClick: true, trusted: true, pendingPhase: 'permission_request', before: { granted: false, origins: [], scripts: [] }, after: { granted: false, origins: [], scripts: [] } }] }, infrastructureErrors: ['AssertionError: No qualified native permission dialog was confirmed'], arbitrary: 'PRIVATE_CANARY' });
async function fixture(fn) { const root = await mkdtemp(join(tmpdir(), 'geld-access-evidence-'));try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }

test('access report exposes actual before/after pending phase without arbitrary fields', () => {
  const source = report();source.providerAccessVerification.clicks[0].after.scripts.push({ id: 'PRIVATE_CANARY', js: ['SECRET_PATH'] });
  source.providerAccessVerification.clicks[0].after.origins.push('https://PRIVATE_CANARY/');
  const value = accessEvidenceSummary(source, Buffer.from('{}'));
  assert.equal(value.providerAccessVerification.clicks[0].pendingPhase, 'permission_request');
  assert.equal(value.providerAccessVerification.clicks[0].after.granted, false);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_CANARY|SECRET_PATH/);assert.equal(value.browserStarted, false);assert.equal(value.providerRequests, 0);
});
test('access evidence requires the actual access focus and bounds error and click output', () => {
  assert.throws(() => accessEvidenceSummary({ ...report(), focus: 'gitlab-ui' }, Buffer.from('{}')), /ACCESS_EVIDENCE_REPORT/);
  const source = report();source.infrastructureErrors = Array.from({ length: 30 }, () => 'x'.repeat(3000));
  source.providerAccessVerification.clicks = Array.from({ length: 30 }, () => ({ provider: 'gitlab', pendingPhase: 'worker_registration' }));
  const value = accessEvidenceSummary(source, Buffer.from('{}'));assert.equal(value.truncated, true);assert.equal(value.infrastructureErrors.length, 16);assert.equal(value.infrastructureErrors[0].length, 2000);assert.equal(value.providerAccessVerification.clicks.length, 2);
});
test('diagnostic exporter reads only report.json and needs no HTML or browser environment', async () => fixture(async root => {
  await writeFile(join(root, 'report.json'), JSON.stringify(report()));const lines=[];
  await exportProviderAccessEvidence(root, line => lines.push(line));assert.equal(lines.length, 1);assert.match(lines[0], /^GELD_PROVIDER_ACCESS_EVIDENCE /);
  assert.equal(JSON.parse(lines[0].slice('GELD_PROVIDER_ACCESS_EVIDENCE '.length)).providerAccessVerification.clicks[0].trusted, true);
}));
test('report-only CLI has no install/browser startup and rejects external directory arguments', async () => fixture(async root => {
  const directory = join(root, '.browser-previous-evidence');await mkdir(directory);await writeFile(join(directory, 'report.json'), JSON.stringify(report()));
  const path=resolve('scripts/provider-access-evidence.mjs');
  const result=spawnSync(process.execPath, [path], { cwd: root, encoding: 'utf8' });assert.equal(result.status,0);assert.match(result.stdout,/"browserStarted":false/);assert.equal(result.stderr,'');
  const bad=spawnSync(process.execPath,[path,'/PRIVATE_CANARY'],{cwd:root,encoding:'utf8'});assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.equal(bad.stderr,'GELD_PROVIDER_ACCESS_EVIDENCE_FAILED ARGUMENTS\n');
}));
