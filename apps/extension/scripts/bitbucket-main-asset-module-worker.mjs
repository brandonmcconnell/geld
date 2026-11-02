import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export const BITBUCKET_MODULE_FILE = 'bitbucket-native-fozrM.js';
export const BITBUCKET_MODULE_LIMIT = 256 * 1024;
export const BITBUCKET_WORKER_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 });
const unavailable = (reason) => ({ status: 'unavailable', reason });

export function extractBitbucketModule(bytes, { signal, deadlineMs = 2000, workerFactory = (options) => new Worker(new URL(import.meta.url), options) } = {}) {
  if (signal?.aborted) return Promise.resolve(unavailable('aborted'));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 6 * 1024 * 1024) return Promise.resolve(unavailable('body_size'));
  return new Promise((resolve) => {
    let worker;let timer;let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;clearTimeout(timer);signal?.removeEventListener('abort', abort);
      worker?.removeAllListeners();void worker?.terminate().catch(() => undefined);resolve(result);
    };
    const abort = () => finish(unavailable('aborted'));
    try {
      worker = workerFactory({ workerData: bytes, resourceLimits: BITBUCKET_WORKER_LIMITS });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(unavailable('worker_deadline')), deadlineMs);
      worker.once('error', () => finish(unavailable('worker_failed')));
      worker.once('exit', () => finish(unavailable('worker_exit')));
      worker.once('message', (result) => {
        if (result?.status === 'extracted' && result.bytes instanceof Uint8Array && result.bytes.byteLength > 0 && result.bytes.byteLength <= BITBUCKET_MODULE_LIMIT
          && Number.isSafeInteger(result.start) && result.start >= 0 && Number.isSafeInteger(result.end) && result.end > result.start
          && Number.isSafeInteger(result.byteStart) && result.byteStart >= 0 && Number.isSafeInteger(result.byteEnd) && result.byteEnd > result.byteStart && result.byteEnd <= bytes.byteLength
          && result.byteEnd - result.byteStart === result.bytes.byteLength && Buffer.from(bytes).subarray(result.byteStart, result.byteEnd).equals(Buffer.from(result.bytes))) finish(result);
        else finish(unavailable(['syntax', 'registration', 'snippet_size', 'utf8'].includes(result?.reason) ? result.reason : 'worker_result'));
      });
      if (signal?.aborted) abort();
    } catch { finish(unavailable('worker_failed')); }
  });
}

async function parseModule(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);if (!Buffer.from(text).equals(Buffer.from(bytes))) return unavailable('utf8'); }
  catch { return unavailable('utf8'); }
  const ts = await import('typescript');
  const source = ts.createSourceFile('native.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length !== 0) return unavailable('syntax');
  const registrations = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length === 2
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'fozrM') {
      let factory = node.arguments[1];
      while (ts.isParenthesizedExpression(factory)) factory = factory.expression;
      if (ts.isFunctionExpression(factory) && factory.asteriskToken === undefined && !factory.modifiers?.length
        && [2, 3].includes(factory.parameters.length) && factory.parameters.every((parameter) => ts.isIdentifier(parameter.name) && parameter.initializer === undefined && parameter.dotDotDotToken === undefined)) registrations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (registrations.length !== 1) return unavailable('registration');
  const call = registrations[0];
  const start = call.getStart(source);const end = call.end;const snippet = Buffer.from(text.slice(start, end));
  if (snippet.byteLength === 0 || snippet.byteLength > BITBUCKET_MODULE_LIMIT) return unavailable('snippet_size');
  const byteStart = Buffer.byteLength(text.slice(0, start));
  return { status: 'extracted', start, end, byteStart, byteEnd: byteStart + snippet.byteLength, sha256: createHash('sha256').update(snippet).digest('hex'), bytes: snippet };
}

if (!isMainThread) {
  try { parentPort?.postMessage(await parseModule(workerData)); }
  catch { parentPort?.postMessage(unavailable('worker_failed')); }
}
