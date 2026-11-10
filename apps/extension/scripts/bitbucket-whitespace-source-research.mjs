import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { BITBUCKET_MODULE_FILES, BITBUCKET_MAX_SOURCE_LIMIT, extractBitbucketModule } from './bitbucket-main-asset-module-worker.mjs';

export const BITBUCKET_WHITESPACE_ASSET = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.5ff3a9b1c1755f86e976fb46708c460744f6ad56.js';
export const BITBUCKET_PR_PAGE_ASSET = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/page.00a49eea.js';
export const BITBUCKET_PR_PAGE_SOURCE_ARCHIVE = 'bitbucket-public-pr-page-00a49eea.js.gz';
export const BITBUCKET_WHITESPACE_BODY_LIMIT = BITBUCKET_MAX_SOURCE_LIMIT;
export const BITBUCKET_WHITESPACE_WORKER_DEADLINE = 10_000;
export const BITBUCKET_WHITESPACE_SOURCE_ARCHIVE = 'bitbucket-public-app-5ff3a9b1c1755f86e976fb46708c460744f6ad56.js.gz';
const compress = promisify(gzip);
const reasons = new Set(['aborted', 'body_size', 'worker_deadline', 'worker_failed', 'worker_memory', 'parser_depth', 'worker_exit', 'worker_result', 'syntax', 'registration', 'snippet_size', 'utf8', 'module_id', 'source_limit']);

/** Exactly one fixed public CDN GET; parsed factories are data and are never executed. */
export async function collectBitbucketWhitespaceFactories({ fetcher = fetch, extractModule = extractBitbucketModule, writeArtifact, retainAsset = false, prPage = false, timeoutMs = 30_000, now = () => new Date().toISOString() } = {}) {
  const assetURL = prPage === true ? BITBUCKET_PR_PAGE_ASSET : BITBUCKET_WHITESPACE_ASSET;
  const archiveFile = prPage === true ? BITBUCKET_PR_PAGE_SOURCE_ARCHIVE : BITBUCKET_WHITESPACE_SOURCE_ARCHIVE;
  const report = { captureMode: prPage === true ? 'pr_page' : 'app_factories', schema: 1, kind: 'public_static_source_research', status: 'unavailable', featureAcceptance: false, executed: false, browserNavigations: 0, providerApiRequests: 0,
    request: { url: assetURL, method: 'GET', startedAt: now(), attempts: 0, credentials: 'omit', redirects: 'manual', byteLimit: BITBUCKET_WHITESPACE_BODY_LIMIT, declaredLength: null, bytesSeen: 0, bytesSeenCapped: false }, modules: {} };
  const controller = new AbortController();const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1, timeoutMs)));
  let reader;
  try {
    if (typeof writeArtifact !== 'function' || typeof retainAsset !== 'boolean' || typeof prPage !== 'boolean') throw new Error('configuration');
    report.request.attempts = 1;
    const response = await fetcher(assetURL, { method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Accept: 'application/javascript' }, signal: controller.signal });
    report.request.status = response.status;reader = response.body?.getReader();
    if (response.redirected || response.url !== assetURL || response.status !== 200) { report.reason = 'http_contract';return report; }
    const mime = /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
    report.request.mime = mime ? 'javascript' : 'unsupported';
    const declared = response.headers.get('content-length');
    const declaredValid = declared === null || /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared));
    report.request.declaredLength = declared !== null && declaredValid ? Number(declared) : null;
    report.request.declaredLengthStatus = declared === null ? 'absent' : declaredValid ? 'valid' : 'invalid';
    if (!mime || !declaredValid || reader === undefined) { report.reason = 'body_contract';return report; }
    if (report.request.declaredLength !== null && report.request.declaredLength > BITBUCKET_WHITESPACE_BODY_LIMIT) { report.reason = 'body_size';return report; }
    const chunks = [];let length = 0;
    for (;;) {
      controller.signal.throwIfAborted();const chunk = await reader.read();if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) { report.reason = 'body_size';return report; }
      const seen = length + chunk.value.byteLength;report.request.bytesSeen = Math.min(seen, BITBUCKET_WHITESPACE_BODY_LIMIT + 1);report.request.bytesSeenCapped = seen > BITBUCKET_WHITESPACE_BODY_LIMIT + 1;
      if (seen > BITBUCKET_WHITESPACE_BODY_LIMIT) { report.reason = 'body_size';return report; }
      chunks.push(chunk.value);length += chunk.value.byteLength;
    }
    if (length === 0) { report.reason = 'body_size';return report; }
    const bytes = Buffer.concat(chunks);report.asset = { bytes: length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (retainAsset || prPage) {
      controller.signal.throwIfAborted();const archive = await compress(bytes, { level: 6 });controller.signal.throwIfAborted();
      if (archive.byteLength > BITBUCKET_WHITESPACE_BODY_LIMIT + 64 * 1024) throw new Error('archive_size');
      await writeArtifact(archiveFile, archive, controller.signal);
      report.asset.archive = { file: archiveFile, encoding: 'gzip', bytes: archive.byteLength, sha256: createHash('sha256').update(archive).digest('hex'), uncompressedBytes: length, uncompressedSha256: report.asset.sha256 };
    }
    if (prPage) { report.status = 'captured';report.parsed = false;return report; }
    for (const moduleId of ['fozrM', 'h43l2']) {
      controller.signal.throwIfAborted();const result = await extractModule(bytes, { signal: controller.signal, moduleId, sourceLimitBytes: BITBUCKET_WHITESPACE_BODY_LIMIT, deadlineMs: BITBUCKET_WHITESPACE_WORKER_DEADLINE });
      if (result.status !== 'extracted') { report.modules[moduleId] = { status: 'unavailable', reason: reasons.has(result.reason) ? result.reason : 'worker_result' };continue; }
      const file = BITBUCKET_MODULE_FILES[moduleId];
      await writeArtifact(file, result.bytes, controller.signal);
      report.modules[moduleId] = { status: 'captured', file, bytes: result.bytes.byteLength, sha256: createHash('sha256').update(result.bytes).digest('hex'), start: result.start, end: result.end, byteStart: result.byteStart, byteEnd: result.byteEnd };
    }
    const captured = Object.values(report.modules).filter((value) => value.status === 'captured').length;
    report.status = captured === 2 ? 'captured' : captured === 1 ? 'partial' : 'unavailable';
    if (captured === 0) report.reason = 'requested_factories_unavailable';
    return report;
  } catch { report.reason = controller.signal.aborted ? 'deadline' : 'capture_failed';return report; }
  finally { clearTimeout(timer);controller.abort();await reader?.cancel().catch(() => undefined);reader?.releaseLock();report.request.finishedAt = now(); }
}

// Exact JavaScript dependencies of the captured c3qHU PR-page loader. No CSS or dynamic URLs.
export const BITBUCKET_PR_DEPENDENCY_FILES = Object.freeze([
  'create-file-route.7472a42a.js', 'route.eeba4a94.js', 'routes.6c9a65b8.js',
  'voice-enabled-footer-row.fb410526.js', 'ConversationAssistantUI.5310e24d.js', 'esm.f9cb7fbe.js',
  'ConversationAssistantUI.dd40091c.js', 'ConversationAssistant.d76eb4da.js',
  'DraftCommentAction.6201809a.js', 'DraftCommentAction.e0a9748f.js', 'SessionRightPanel.907131d4.js',
  'onboarding.a207a86a.js', 'onboarding.6c418ecf.js', 'routes.6fa8cad2.js', 'provider.15e339ac.js',
  'modal.0d28ee57.js', 'project-settings-menu-page.85c3ffe5.js', 'project-settings-menu-page.614e2ea2.js',
  'project-settings-menu-page.0e501094.js', 'project-settings-menu-page.be0d17fd.js',
  'component-lazy.0e485afd.js', 'ssh-keys.984a187e.js', 'page.00a49eea.js',
]);
export const BITBUCKET_PR_DEPENDENCY_LIMIT = 8 * 1024 * 1024;
export const BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT = 64 * 1024 * 1024;
const dependencyBase = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fixed public static source only: four concurrent GETs, no retries, parsing or execution. */
export async function collectBitbucketPrDependencies({ fetcher = fetch, writeArtifact, timeoutMs = 90_000, now = () => new Date().toISOString() } = {}) {
  const report = { schema: 1, kind: 'public_static_source_research', captureMode: 'pr_dependencies', status: 'unavailable',
    featureAcceptance: false, executed: false, parsed: false, browserNavigations: 0, providerApiRequests: 0,
    limits: { concurrency: 4, assetBytes: BITBUCKET_PR_DEPENDENCY_LIMIT, totalBytes: BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT, wallMs: 90_000 },
    bytesSeen: 0, bytesSeenCapped: false, requests: BITBUCKET_PR_DEPENDENCY_FILES.map((file) => ({ file, url: dependencyBase + file,
      method: 'GET', attempts: 0, credentials: 'omit', redirects: 'manual', status: 'unavailable', declaredLength: null, bytesSeen: 0, bytesSeenCapped: false })) };
  if (typeof writeArtifact !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1) { report.reason = 'configuration';return report; }
  const controller = new AbortController();let next = 0;
  const timer = setTimeout(() => { report.reason = 'deadline';controller.abort(); }, Math.min(90_000, timeoutMs));
  const bounded = (operation) => new Promise((resolve, reject) => {
    const abort = () => { cleanup();reject(new Error('aborted')); }, cleanup = () => controller.signal.removeEventListener('abort', abort);
    if (controller.signal.aborted) { reject(new Error('aborted'));return; }
    controller.signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { controller.signal.throwIfAborted();return operation(); }).then((value) => { cleanup();resolve(value); }, (error) => { cleanup();reject(error); });
  });
  async function capture(request) {
    let reader;
    request.startedAt = now();request.attempts = 1;
    try {
      const response = await bounded(() => fetcher(request.url, { method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Accept: 'application/javascript' }, signal: controller.signal }));
      controller.signal.throwIfAborted();request.httpStatus = response.status;reader = response.body?.getReader();
      if (response.redirected || response.url !== request.url || response.status !== 200) { request.reason = 'http_contract';return; }
      const mime = /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
      request.mime = mime ? 'javascript' : 'unsupported';
      const declared = response.headers.get('content-length'), valid = declared === null || /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared));
      request.declaredLength = declared !== null && valid ? Number(declared) : null;
      request.declaredLengthStatus = declared === null ? 'absent' : valid ? 'valid' : 'invalid';
      if (!mime || !valid || reader === undefined) { request.reason = 'body_contract';return; }
      if (request.declaredLength !== null && request.declaredLength > BITBUCKET_PR_DEPENDENCY_LIMIT) { request.reason = 'body_size';return; }
      const chunks = [];let length = 0;
      for (;;) {
        const chunk = await bounded(() => reader.read());controller.signal.throwIfAborted();if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) { request.reason = 'body_contract';return; }
        const size = chunk.value.byteLength, seen = length + size;
        request.bytesSeen = Math.min(seen, BITBUCKET_PR_DEPENDENCY_LIMIT + 1);request.bytesSeenCapped = seen > BITBUCKET_PR_DEPENDENCY_LIMIT + 1;
        const total = report.bytesSeen + size;report.bytesSeen = Math.min(total, BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT + 1);report.bytesSeenCapped ||= total > BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT + 1;
        if (total > BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT) { request.reason = 'total_size';report.reason = 'total_size';controller.abort();return; }
        if (seen > BITBUCKET_PR_DEPENDENCY_LIMIT) { request.reason = 'body_size';return; }
        chunks.push(chunk.value);length = seen;
      }
      if (length === 0) { request.reason = 'body_size';return; }
      const bytes = Buffer.concat(chunks), archive = await bounded(() => compress(bytes, { level: 6 }));controller.signal.throwIfAborted();
      if (archive.byteLength > BITBUCKET_PR_DEPENDENCY_LIMIT + 64 * 1024) { request.reason = 'archive_size';return; }
      const file = `bitbucket-public-pr-dependency-${request.file}.gz`;
      await bounded(() => writeArtifact(file, archive, controller.signal));controller.signal.throwIfAborted();
      request.asset = { bytes: length, sha256: hash(bytes), archive: { file, encoding: 'gzip', bytes: archive.byteLength, sha256: hash(archive), uncompressedBytes: length, uncompressedSha256: hash(bytes) } };
      request.status = 'captured';
    } catch { request.reason = controller.signal.aborted ? report.reason ?? 'aborted' : 'capture_failed'; }
    finally { if (reader) { try { Promise.resolve(reader.cancel()).catch(() => undefined); } catch {} try { reader.releaseLock(); } catch {} }request.finishedAt = now(); }
  }
  try {
    await Promise.all(Array.from({ length: 4 }, async () => { while (!controller.signal.aborted && next < report.requests.length) await capture(report.requests[next++]); }));
    for (const request of report.requests) if (request.attempts === 0) request.reason = 'batch_aborted';
    const count = report.requests.filter((request) => request.status === 'captured').length;
    report.status = count === report.requests.length ? 'captured' : count > 0 ? 'partial' : 'unavailable';
    return report;
  } finally { clearTimeout(timer);controller.abort();report.finishedAt = now(); }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.env.GELD_SOURCE_ARTIFACTS ?? 'artifacts/bitbucket-source-research');await mkdir(directory, { recursive: true });
  const options = { writeArtifact: (file, bytes, signal) => writeFile(resolve(directory, file), bytes, { signal }) };
  const report = process.argv.includes('--pr-dependencies') ? await collectBitbucketPrDependencies(options) : await collectBitbucketWhitespaceFactories({ ...options, retainAsset: process.argv.includes('--retain-asset'), prPage: process.argv.includes('--pr-page') });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Bitbucket static source research: ${report.status}; no browser navigation, API request or feature acceptance.`);
  process.exitCode = report.status === 'unavailable' ? 1 : 0;
}
