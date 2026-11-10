/** Read-only transport of existing public-browser artifacts; this never starts a browser. */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EVIDENCE_FILES = Object.freeze([
  'gitlab-dashboard-native-hidden.html', 'gitlab-dashboard-native-hidden.png',
  'gitlab-overview-digest-failed.html', 'gitlab-overview-digest-failed.png',
  'bitbucket-dashboard-native-hidden.html', 'bitbucket-dashboard-native-hidden.png',
  'bitbucket-dashboard-native-dark.html', 'bitbucket-dashboard-native-dark.png',
  'bitbucket-ui-continuity-failed.html', 'bitbucket-ui-continuity-failed.png',
  'bitbucket-comment-digest-failed.html', 'bitbucket-comment-digest-failed.png',
]);
export const EVIDENCE_LIMITS = Object.freeze({ report: 2 * 1024 * 1024, html: 4 * 1024 * 1024, png: 4 * 1024 * 1024, gzip: 1024 * 1024, totalGzip: 3 * 1024 * 1024, chunk: 12 * 1024 });
const sha = value => createHash('sha256').update(value).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
export async function readEvidenceFile(directory, name, limit) {
  if (!['report.json', ...EVIDENCE_FILES].includes(name)) fail('EVIDENCE_PATH');
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) fail('EVIDENCE_PATH');
  const path = resolve(directory, name);
  const before = await lstat(path).catch(error => { if (error?.code === 'ENOENT') return null;fail('EVIDENCE_READ'); });
  if (before === null) return null;
  if (!before.isFile() || before.isSymbolicLink()) fail('EVIDENCE_PATH');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
    if (error?.code === 'ENOENT') return null;
    fail('EVIDENCE_READ');
  });
  if (file === null) return null;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) fail('EVIDENCE_PATH');
    if (stat.size > limit) fail('EVIDENCE_SIZE');
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > limit) fail('EVIDENCE_SIZE');
    return buffer.subarray(0, used);
  } finally { await file.close(); }
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
export function summarizeProviderEvidence(report, raw) {
  if (report?.schema !== 1 || !Array.isArray(report.cases) || report.cases.length > 100) fail('EVIDENCE_REPORT');
  const names = new Set(['gitlab-mixed', 'gitlab-overview-digest', 'bitbucket-ui-continuity', 'bitbucket-comment-digest']);
  const statuses = new Set(['passed', 'failed', 'unavailable', 'rate_limited', 'not_selected', 'running']);
  return {
    schema: 1, reportSha256: sha(raw), reportBytes: raw.length, startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt),
    cooldowns: Object.fromEntries(['github', 'gitlab', 'bitbucket'].map(provider => [provider, timestamp(report.cooldowns?.[provider])])),
    bitbucketRequests: count(report.observedBitbucketApiRequests), rollingRequestCount: Array.isArray(report.bitbucketAnonymousRequestTimes) ? report.bitbucketAnonymousRequestTimes.length : null,
    cases: report.cases.filter(item => names.has(item.name)).map(item => ({
      name: item.name, status: statuses.has(item.status) ? item.status : 'unknown', startedAt: timestamp(item.startedAt), finishedAt: timestamp(item.finishedAt),
      errorKind: item.holdReason === 'provider_http429' ? 'http429' : /body|Original conversation/.test(item.error ?? '') ? 'conversation_custody' : /owned panel/.test(item.error ?? '') ? 'category_geometry' : /Adjusted additions/.test(item.error ?? '') ? 'visible_counts' : item.error ? 'other' : null,
      custody: Object.fromEntries(['identityMismatches', 'parentMismatches', 'idMismatches', 'bodyMismatches', 'unqualifiedPayloads'].map(key => [key, count(item.dashboardUi?.baseline?.custody?.[key])])),
    })),
  };
}
export async function emitProviderEvidence({ directory = resolve('.browser-previous-evidence'), write = line => process.stdout.write(line + '\n') } = {}) {
  const raw = await readEvidenceFile(directory, 'report.json', EVIDENCE_LIMITS.report);
  if (raw === null) fail('EVIDENCE_REPORT');
  let report;
  try { report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('EVIDENCE_REPORT'); }
  const summary = summarizeProviderEvidence(report, raw);
  write(`GELD_EVIDENCE_SUMMARY ${JSON.stringify(summary)}`);
  let total = 0, emitted = 0;
  for (const file of EVIDENCE_FILES) {
    const bytes = await readEvidenceFile(directory, file, file.endsWith('.html') ? EVIDENCE_LIMITS.html : EVIDENCE_LIMITS.png);
    if (bytes === null) { write(`GELD_EVIDENCE_MISSING ${JSON.stringify({ file })}`);continue; }
    const gzip = gzipSync(bytes);
    if (gzip.length > EVIDENCE_LIMITS.gzip || total + gzip.length > EVIDENCE_LIMITS.totalGzip) fail('EVIDENCE_COMPRESSED_SIZE');
    total += gzip.length;
    const data = gzip.toString('base64');
    const chunks = Math.ceil(data.length / EVIDENCE_LIMITS.chunk);
    write(`GELD_EVIDENCE_META ${JSON.stringify({ file, encoding: 'gzip+base64', rawBytes: bytes.length, gzipBytes: gzip.length, rawSha256: sha(bytes), gzipSha256: sha(gzip), chunks })}`);
    for (let index = 0; index < chunks; index++) write(`GELD_EVIDENCE_CHUNK ${JSON.stringify({ file, index, chunks, data: data.slice(index * EVIDENCE_LIMITS.chunk, (index + 1) * EVIDENCE_LIMITS.chunk) })}`);
    emitted++;
  }
  if (emitted === 0) fail('EVIDENCE_FILES_MISSING');
  write(`GELD_EVIDENCE_DONE ${JSON.stringify({ files: emitted, gzipBytes: total, providerRequests: 0, browserStarted: false })}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) fail('EVIDENCE_ARGUMENTS');
    await emitProviderEvidence();
  } catch (error) {
    const code = new Set(['EVIDENCE_PATH', 'EVIDENCE_READ', 'EVIDENCE_SIZE', 'EVIDENCE_REPORT', 'EVIDENCE_COMPRESSED_SIZE', 'EVIDENCE_FILES_MISSING', 'EVIDENCE_ARGUMENTS']).has(error?.code) ? error.code : 'EVIDENCE_READ';
    process.stderr.write(`GELD_EVIDENCE_FAILED ${code}\n`);process.exitCode = 1;
  }
}
