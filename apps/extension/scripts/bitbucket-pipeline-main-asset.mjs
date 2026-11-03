import { createHash } from 'node:crypto';
import { BITBUCKET_MODULE_FILE, extractBitbucketModule } from './bitbucket-main-asset-module-worker.mjs';

export const BITBUCKET_PIPELINE_MAIN_ASSET = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/app.8c0b6f48dd68c4fd8f958592a0de8efebbdf6d2d.js';
export const BITBUCKET_PIPELINE_MAIN_FILE = 'bitbucket-native-app-8c0b6f48dd68c4fd8f958592a0de8efebbdf6d2d.js';
const LIMIT = 6 * 1024 * 1024;
const MODULE_ORIGIN = 'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net';

function moduleAssetURL(value) {
  try {
    const url = new URL(value);
    return url.href === value && value === `${MODULE_ORIGIN}${url.pathname}` && url.origin === MODULE_ORIGIN && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
      && /^\/assets\/app\.[a-f0-9]{40}\.js$/.test(url.pathname);
  } catch { return false; }
}

/** Read one already-issued main-frame script response only. No fetch, retry or script execution. */
export function observeBitbucketPipelineMainAsset(page, progress, { writeArtifact, settleMs = 2000, moduleOnly = false, extractModule = extractBitbucketModule }) {
  progress.status = 'observing';if (!moduleOnly) progress.url = BITBUCKET_PIPELINE_MAIN_ASSET;progress.limitBytes = LIMIT;
  progress.purpose = 'Optional offline native-source evidence only, never a feature or native preference pass.';
  if (moduleOnly) { progress.selector = 'single_fingerprinted_first_party_app_script';progress.output = 'fozrM_module_only';progress.sizeLimitScope = 'Declared and post-read decoded checks, not a streaming allocation bound'; }
  let task;let stopped = false;let cleanup;const controller = new AbortController();
  const unavailable = (reason) => { if (!stopped) { progress.status = 'unavailable';progress.reason = reason; } };
  const response = (value) => {
    if (stopped || task !== undefined) return;
    const selectedURL = value.url();
    if (moduleOnly ? !moduleAssetURL(selectedURL) : selectedURL !== BITBUCKET_PIPELINE_MAIN_ASSET) return;
    if (moduleOnly) progress.url = selectedURL;
    // Claim one eligible response immediately, including refusal, to prevent retries.
    task = (async () => {
      try {
        const request = value.request();progress.httpStatus = value.status();
        if (request.url() !== selectedURL || request.method() !== 'GET' || request.resourceType() !== 'script' || request.frame() !== page.mainFrame() || request.redirectChain().length !== 0) { unavailable('Exact main-frame unredirected native script contract unavailable');return; }
        const headers = value.headers();const mime = headers['content-type'] ?? '';const javascript = /^(?:application|text)\/(?:x-)?(?:javascript|ecmascript)(?:\s*;|$)/i.test(mime);progress.mime = moduleOnly ? javascript ? 'javascript' : 'unsupported' : mime.slice(0, 200);
        if (value.status() !== 200 || !javascript) { unavailable('Native response is not HTTP200 JavaScript');return; }
        const length = headers['content-length'];
        if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > LIMIT)) { unavailable('Native script declared length is invalid or exceeds6MiB');return; }
        const bytes = await value.buffer();
        if (stopped) return;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > LIMIT) { unavailable('Native decoded script is empty, invalid or exceeds6MiB');return; }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (moduleOnly) {
          progress.asset = { bytes: bytes.byteLength, sha256 };
          const result = await extractModule(bytes, { signal: controller.signal });
          if (stopped) return;
          if (result.status !== 'extracted') { unavailable(result.reason);return; }
          await writeArtifact(BITBUCKET_MODULE_FILE, result.bytes, controller.signal);
          if (stopped) return;
          progress.status = 'captured';progress.file = BITBUCKET_MODULE_FILE;progress.executed = false;
          progress.module = { bytes: result.bytes.byteLength, sha256: createHash('sha256').update(result.bytes).digest('hex'), start: result.start, end: result.end, byteStart: result.byteStart, byteEnd: result.byteEnd };
        } else {
          await writeArtifact(BITBUCKET_PIPELINE_MAIN_FILE, bytes, controller.signal);
          if (stopped) return;
          progress.status = 'captured';progress.file = BITBUCKET_PIPELINE_MAIN_FILE;progress.bytes = bytes.byteLength;progress.sha256 = sha256;progress.executed = false;
        }
      } catch (error) { unavailable(moduleOnly ? 'capture_failed' : (error instanceof Error ? error.message : String(error)).slice(0, 300)); }
    })();
  };
  page.on('response', response);
  return {
    dispose() {
      if (cleanup !== undefined) return cleanup;
      page.off('response', response);progress.cleanup = { listenerRemoved: true, status: 'settling' };
      cleanup = (async () => {
        let timer;
        const complete = task === undefined || await Promise.race([task.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), settleMs); })]);
        clearTimeout(timer);
        if (!complete) { unavailable('Native script response body did not settle before the bounded page-close deadline');controller.abort(); }
        else if (task === undefined) unavailable(moduleOnly ? 'Eligible fingerprinted first-party app script was not available in an already-issued script response' : 'Exact observed native app version was not available in an already-issued script response');
        stopped = true;progress.cleanup.status = complete ? 'settled' : 'timed_out';progress.cleanup.pendingBodyMayRemain = !complete;
        return progress;
      })();return cleanup;
    },
  };
}
