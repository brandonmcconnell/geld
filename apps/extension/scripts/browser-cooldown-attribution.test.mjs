import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-02T20:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (at) => new Date(at).toISOString();
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
async function inherited(previous, limit = 40) {
  const original = JSON.stringify(previous), times = [], cooldowns = new Map();
  const report = { quotaPolicy: { conservativeObservedRequestBudget: limit } };
  const context = { assert, URL, Date: class extends Date { static now() { return NOW; } },
    process: { env: { GELD_BROWSER_PREVIOUS_REPORT: 'unchanged-report.json' } },
    readFile: async () => original, report, bitbucketRequestTimes: times, cooldowns,
    BITBUCKET_ANONYMOUS_COOLDOWN_MS: 62 * 60 * 1000 };
  vm.createContext(context);
  vm.runInContext(section('function providerOf(', 'function retryAfter(') + section('function sourceFailureProvider(', 'function closedTarget('), context);
  await vm.runInContext('inheritCooldowns()', context);
  assert.equal(JSON.stringify(previous), original, 'the prior artifact must remain untouched');
  return { context, times, cooldowns, report };
}
function previous(cases = [], extra = {}) { return { schema: 1, cases, ...extra }; }
function failure(failure, item = {}) { return { url: 'https://bitbucket.org/workspace/repo/pull-requests/1', finishedAt: iso(NOW - 1000), sourceFailures: [failure], ...item }; }

test('only actual Bitbucket source failures gain the legacy anonymous429 fallback', async () => {
  for (const sourceFailure of [
    { provider: 'bitbucket', url: '[native_resource_omitted]' },
    { url: 'https://api.bitbucket.org/2.0/repositories/workspace/repo' },
    { provider: 'unclassified', url: 'https://bitbucket.org/!api/2.0/test' },
  ]) {
    const result = await inherited(previous([failure({ ...sourceFailure, status: 429, retryAfter: null, observedAt: iso(NOW - 5000) })]));
    assert.equal(result.cooldowns.get('bitbucket'), NOW - 5000 + 62 * 60 * 1000);
  }
});

test('unclassified, omitted and third-party429 never acquire the containing page provider', async () => {
  for (const sourceFailure of [
    { provider: 'unclassified', url: '[native_resource_omitted]' },
    { url: 'https://telemetry.example.test/events' },
    { provider: 'github', url: '[native_resource_omitted]' },
    { provider: 'gitlab', url: 'https://api.bitbucket.org/2.0/test' },
  ]) {
    const result = await inherited(previous([failure({ ...sourceFailure, status: 429 })]));
    assert.equal(result.cooldowns.size, 0);
  }
});

test('actual cooldown maps, explicit case provider and Retry-After deadlines remain authoritative', async () => {
  const deadline = iso(NOW + 9000), gitlabDeadline = iso(NOW + 12000);
  const result = await inherited(previous([
    failure({ provider: 'bitbucket', status: 429, retryAfter: '9' }, { rateLimitedUntil: deadline }),
    failure({ provider: 'gitlab', status: 429, retryAfter: '12' }, { cooldownProvider: 'gitlab', rateLimitedUntil: gitlabDeadline }),
  ], { cooldowns: { bitbucket: deadline, github: iso(NOW + 3000) } }));
  assert.equal(result.cooldowns.get('bitbucket'), Date.parse(deadline));
  assert.equal(result.cooldowns.get('gitlab'), Date.parse(gitlabDeadline));
  assert.equal(result.cooldowns.get('github'), NOW + 3000);
  // Honor an already retained legacy hold once, even if its historic cause was misclassified.
  const legacy = await inherited(previous([], { cooldowns: { bitbucket: iso(NOW + HOUR) } }));
  assert.equal(legacy.cooldowns.get('bitbucket'), NOW + HOUR);
});

test('42 imported equal timestamps stay42 budget observations and create no server cooldown', async () => {
  const result = await inherited(previous([], { bitbucketAnonymousRequestTimes: Array(42).fill(iso(NOW - 10000)) }));
  assert.equal(result.times.length, 42);
  assert.equal(result.cooldowns.size, 0);
  assert.equal(result.report.previousEvidence.inheritedBudgetHold.observedRequests, 42);
  assert.equal(result.report.previousEvidence.inheritedBudgetHold.observedLimit, 40);
  assert.equal(result.report.previousEvidence.inheritedBudgetHold.availableAt, iso(NOW - 10000 + HOUR + 1));
  assert.deepEqual(Object.keys(result.report.previousEvidence.inheritedCooldowns), []);
});

test('a budget gate applies only to cases that need Bitbucket and waits for enough real expiries', async () => {
  const times = [NOW - HOUR + 1000, NOW - HOUR + 2000, NOW - HOUR + 3000, ...Array(39).fill(NOW - 1000)];
  const result = await inherited(previous([], { bitbucketAnonymousRequestTimes: times.map(iso) }));
  const gate = section('    const provider = providerOf(url);', '    currentCaseAbort = abort;');
  const run = (name, url) => {
    const item = {};result.context.item = item;result.context.name = name;result.context.url = url;
    return { item, invoke: () => vm.runInContext(`(() => { ${gate} })()`, result.context) };
  };
  const gh = run('github-digest', 'https://github.com/owner/repo/pull/1');gh.invoke();
  assert.equal(gh.item.budgetHold, undefined);
  assert.equal(result.cooldowns.size, 0);
  const bb = run('bitbucket-local-reviewed', 'https://bitbucket.org/workspace/repo/pull-requests/1');
  assert.throws(bb.invoke, /observed request budget is full/);
  assert.equal(bb.item.navigationSuppressedByBudget, true);
  assert.equal(bb.item.budgetHold.firstExpiry, iso(NOW + 1001));
  assert.equal(bb.item.budgetHold.availableAt, iso(NOW + 3001));
  assert.equal(bb.item.rateLimitedUntil, undefined);
});

test('actual request observer stops at40 or47 without manufacturing a server cooldown', async () => {
  for (const limit of [40, 47]) {
    const result = await inherited(previous(), limit);
    const context = result.context;context.bitbucketApi = () => true;context.bitbucketApiRequests = 0;
    const observe = vm.runInContext(section('function observeBitbucketBudget(', 'async function runCase(') + ';observeBitbucketBudget', context);
    const page = new EventEmitter();let closed = 0;page.close = async () => { closed++; };
    const item = {}, abort = new AbortController();observe(page, item, abort);
    for (let index = 0; index < limit - 1; index++) page.emit('request', { url: () => 'https://api.bitbucket.org/2.0/test' });
    assert.equal(abort.signal.aborted, false);
    page.emit('request', { url: () => 'https://api.bitbucket.org/2.0/test' });
    assert.equal(abort.signal.aborted, true);assert.equal(closed, 1);
    assert.equal(result.cooldowns.size, 0);assert.equal(item.rateLimitedUntil, undefined);
    assert.equal(item.budgetHold.observedLimit, limit);assert.equal(result.times.length, limit);
  }
});


test('live actual429 keeps Retry-After and aborts only the response provider', async () => {
  for (const [url, provider, seconds] of [
    ['https://api.bitbucket.org/2.0/test', 'bitbucket', '120'],
    ['https://gitlab.com/api/v4/projects', 'gitlab', '5'],
    ['https://telemetry.example.test/collect', null, '120'],
  ]) {
    const result = await inherited(previous());
    const item = {}, abort = new AbortController();let closed = false;
    Object.assign(result.context, { item, abort, page: { close: async () => { closed = true; } },
      response: { status: () => 429 }, headers: { 'retry-after': seconds }, resourceProvider: provider });
    vm.runInContext(section('function retryAfter(', 'function quotaHeaders('), result.context);
    const start = source.indexOf('      if (response.status() === 429 && resourceProvider !== null)');
    const end = source.indexOf('\n    });', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), result.context);
    assert.equal(abort.signal.aborted, provider !== null);assert.equal(closed, provider !== null);
    if (provider === null) assert.equal(result.cooldowns.size, 0);
    else {
      assert.equal(result.cooldowns.get(provider), NOW + Number(seconds) * 1000);
      assert.equal(item.rateLimitedUntil, iso(NOW + Number(seconds) * 1000));
      assert.equal(item.cooldownProvider, provider);
    }
  }
});

for (const offset of [9000, -1000]) for (const origin of ['map', 'case', 'both']) test(`privacy-shaped429 preserves ${origin} explicit deadline offset${offset} without extending or reviving it`, async () => {
  const deadline = iso(NOW + offset);
  const item = failure({ provider: 'bitbucket', url: '[native_resource_omitted]', status: 429, observedAt: iso(NOW - 10000) }, origin === 'map' ? {} : { cooldownProvider: 'bitbucket', rateLimitedUntil: deadline });
  const result = await inherited(previous([item], origin === 'case' ? {} : { cooldowns: { bitbucket: deadline } }));
  assert.equal(result.cooldowns.get('bitbucket'), offset > 0 ? NOW + offset : undefined);
});

test('explicit deadlines in later cases are collected before legacy source-failure fallback', async () => {
  const deadline = iso(NOW + 9000);
  const result = await inherited(previous([failure({ provider: 'bitbucket', status: 429, observedAt: iso(NOW - 10000) }), { url: 'https://github.com/owner/repo/pull/1', cooldownProvider: 'bitbucket', rateLimitedUntil: deadline }]));
  assert.equal(result.cooldowns.get('bitbucket'), NOW + 9000);
});

test('a real429 response keeps its classification when its request also reached the internal cap', async () => {
  const result = await inherited(previous());const item = {}, abort = new AbortController();
  Object.assign(result.context, { item, abort, bitbucketApi: () => true, bitbucketApiRequests: 0, page: new EventEmitter() });
  result.context.page.close = async () => {};
  const observe = vm.runInContext(section('function observeBitbucketBudget(', 'async function runCase(') + ';observeBitbucketBudget', result.context);
  observe(result.context.page, item, abort);
  for (let index = 0; index < 40; index++) result.context.page.emit('request', { url: () => 'https://api.bitbucket.org/2.0/test' });
  assert.ok(item.budgetHold);assert.equal(item.rateLimitedUntil, undefined);
  Object.assign(result.context, { response: { status: () => 429 }, headers: { 'retry-after': '120' }, resourceProvider: 'bitbucket', wholePrivacy: false, shellPrivacy: false, fileMenuPrivacy: false, whitespacePrivacy: false, name: 'github-digest', discovery: false });
  vm.runInContext(section('function retryAfter(', 'function quotaHeaders('), result.context);
  const start = source.indexOf('      if (response.status() === 429 && resourceProvider !== null)');
  vm.runInContext(source.slice(start, source.indexOf('\n    });', start)), result.context);
  const runStart = source.indexOf('async function runCase('), catchStart = source.indexOf('  } catch (error) {', runStart);
  const assignment = source.slice(source.indexOf('    item.status = ', catchStart), source.indexOf('\n', source.indexOf('    item.status = ', catchStart)));
  vm.runInContext(assignment, result.context);
  assert.equal(item.status, 'rate_limited');assert.equal(item.cooldownProvider, 'bitbucket');
  assert.equal(item.rateLimitedUntil, iso(NOW + 120000));assert.equal(result.cooldowns.get('bitbucket'), NOW + 120000);
});


test('actual report checkpoints log bounded counts, inherited deadlines and expiry without source data', async () => {
  const logs = [], writes = [];
  const times = Array.from({ length: 40 }, (_, index) => NOW - 1000 + index);
  const deadline = NOW + 60_000;
  const report = {
    cases: [{ name: 'PRIVATE_CASE', url: 'https://PRIVATE_URL/', observedBitbucketApiRequests: 3, budgetHold: { arbitrary: 'PRIVATE_BODY' }, inProgress: true }], infrastructureErrors: [],
    quotaPolicy: { conservativeObservedRequestBudget: 40, externalRequestReserve: 0 }, observedBitbucketApiRequests: 3,
    previousEvidence: { path: 'PRIVATE_PATH', inheritedAnonymousRequestsWithinRollingHour: 37, inheritedCooldowns: { bitbucket: iso(deadline), ignored: 'PRIVATE_VALUE' } },
  };
  const save = vm.runInNewContext(section('let reportWrite;', 'function sourceFailureProvider(') + ';saveReport', {
    report, cooldowns: new Map([['bitbucket', deadline]]), bitbucketRequestTimes: times, focus: 'bitbucket-ui', artifacts: '/private',
    Date: class extends Date { static now() { return NOW; } }, resolve: (...parts) => parts.join('/'),
    writeFile: async (_path, raw) => writes.push(JSON.parse(raw)), console: { log: value => logs.push(value) },
  });
  await save();await save();assert.equal(logs.length, 1, 'unchanged snapshots do not spam logs');
  const summary = JSON.parse(logs[0].slice('QUOTA_SUMMARY: '.length));
  assert.equal(summary.limit, 40);assert.equal(summary.activeWithinHour, 40);assert.equal(summary.observedThisRun, 3);assert.equal(summary.inheritedAtStart, 37);
  assert.equal(summary.availableBelowLimitAt, iso(times[0] + HOUR + 1));
  assert.equal(summary.inheritedCooldowns.bitbucket, iso(deadline));assert.equal(summary.currentCooldowns.bitbucket, iso(deadline));
  assert.deepEqual(summary.cases, [{ index: 0, observed: 3, budgetHeld: true, serverRateLimited: false, navigationSuppressed: false }]);
  assert.doesNotMatch(logs.join(''), /PRIVATE_|https?:/);assert.deepEqual(times, Array.from({ length: 40 }, (_, index) => NOW - 1000 + index));
  assert.equal(writes.length, 2);assert.equal(writes[0].status, 'running');
  report.cases[0].navigationSuppressedByBudget = true;await save();assert.equal(logs.length, 2);
});
