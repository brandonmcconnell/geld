import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BITBUCKET_MODULE_FILES, extractBitbucketModule } from './bitbucket-main-asset-module-worker.mjs';

export const BITBUCKET_WHITESPACE_ASSET = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.6ea3303b1b2659fcb5ca5dc82e17933a815f4108.js';
export const BITBUCKET_WHITESPACE_BODY_LIMIT = 6 * 1024 * 1024;
const reasons = new Set(['aborted', 'body_size', 'worker_deadline', 'worker_failed', 'worker_exit', 'worker_result', 'syntax', 'registration', 'snippet_size', 'utf8', 'module_id']);

/** Exactly one fixed public CDN GET; parsed factories are data and are never executed. */
export async function collectBitbucketWhitespaceFactories({ fetcher = fetch, extractModule = extractBitbucketModule, writeArtifact, timeoutMs = 30_000, now = () => new Date().toISOString() } = {}) {
  const report = { schema: 1, kind: 'public_static_source_research', status: 'unavailable', featureAcceptance: false, executed: false, browserNavigations: 0, providerApiRequests: 0,
    request: { url: BITBUCKET_WHITESPACE_ASSET, method: 'GET', startedAt: now(), attempts: 0, credentials: 'omit', redirects: 'manual', byteLimit: BITBUCKET_WHITESPACE_BODY_LIMIT }, modules: {} };
  const controller = new AbortController();const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1, timeoutMs)));
  let reader;
  try {
    if (typeof writeArtifact !== 'function') throw new Error('writer');
    report.request.attempts = 1;
    const response = await fetcher(BITBUCKET_WHITESPACE_ASSET, { method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Accept: 'application/javascript' }, signal: controller.signal });
    report.request.status = response.status;reader = response.body?.getReader();
    if (response.redirected || response.url !== BITBUCKET_WHITESPACE_ASSET || response.status !== 200) { report.reason = 'http_contract';return report; }
    const mime = /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
    report.request.mime = mime ? 'javascript' : 'unsupported';
    const declared = response.headers.get('content-length');
    if (!mime || declared !== null && (!/^\d+$/.test(declared) || Number(declared) > BITBUCKET_WHITESPACE_BODY_LIMIT) || reader === undefined) { report.reason = 'body_contract';return report; }
    const chunks = [];let length = 0;
    for (;;) {
      controller.signal.throwIfAborted();const chunk = await reader.read();if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || length + chunk.value.byteLength > BITBUCKET_WHITESPACE_BODY_LIMIT) { report.reason = 'body_size';return report; }
      chunks.push(chunk.value);length += chunk.value.byteLength;
    }
    if (length === 0) { report.reason = 'body_size';return report; }
    const bytes = Buffer.concat(chunks);report.asset = { bytes: length, sha256: createHash('sha256').update(bytes).digest('hex') };
    for (const moduleId of ['fozrM', 'h43l2']) {
      controller.signal.throwIfAborted();const result = await extractModule(bytes, { signal: controller.signal, moduleId });
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.env.GELD_SOURCE_ARTIFACTS ?? 'artifacts/bitbucket-source-research');await mkdir(directory, { recursive: true });
  const report = await collectBitbucketWhitespaceFactories({ writeArtifact: (file, bytes, signal) => writeFile(resolve(directory, file), bytes, { signal }) });
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Bitbucket static source research: ${report.status}; no browser navigation, API request or feature acceptance.`);
  process.exitCode = report.status === 'unavailable' ? 1 : 0;
}
