import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const begin = source.indexOf('function assertGitLabReferenceIndex(');
const end = source.indexOf('\nasync function gitLabReferencesEvidence(', begin);
assert.ok(begin > 0 && end > begin);
const verify = new vm.Script(`((assert) => (${source.slice(begin, end)}))`).runInThisContext()(assert);

function fixture() {
  const targets = [
    { repository: 'whitebox-aero/insta360', project: '56211886', nativeId: '488556842', number: '34', kind: 'merge-request', href: 'https://gitlab.com/whitebox-aero/insta360/-/merge_requests/34' },
    { repository: 'whitebox-aero/whitebox-plugin-device-insta360', project: '62516629', nativeId: '488807245', number: '44', kind: 'merge-request', href: 'https://gitlab.com/whitebox-aero/whitebox-plugin-device-insta360/-/merge_requests/44' },
    { repository: 'whitebox-aero/whitebox', project: '56243493', nativeId: '185462933', number: '531', kind: 'issue', href: 'https://gitlab.com/whitebox-aero/whitebox/-/work_items/531' },
  ];
  const entry = (target, direction) => ({ ...target, label: `${target.repository}!${target.number}`, title: 'Retained native title', source: direction === 'outgoing' ? 'description' : target.number === '34' ? 'note_3381331989' : 'note_3381332675', native: { label: `${target.repository}!${target.number}`, title: 'Retained native title' }, initializationHooks: false });
  return { outgoing: targets.map((target) => entry(target, 'outgoing')), incoming: [targets[0], targets[2]].map((target) => entry(target, 'incoming')) };
}

test('accepts the exact retained native target/source identities in either native row order', () => {
  const value = fixture();value.outgoing.reverse();verify(value);
});

test('rejects missing or extra references rather than accepting partial groups', () => {
  const missing = fixture();missing.incoming.pop();assert.throws(() => verify(missing));
  const extra = fixture();extra.outgoing.push(extra.outgoing[0]);assert.throws(() => verify(extra));
});

for (const key of ['repository', 'project', 'nativeId', 'number', 'kind', 'href']) {
  test(`rejects changed authoritative ${key}`, () => {
    const value = fixture();value.outgoing[0][key] = 'wrong';assert.throws(() => verify(value));
  });
}

test('rejects a mismatched source note and absent or changed native link presentation', () => {
  const source = fixture();source.incoming[0].source = 'note_999';assert.throws(() => verify(source));
  const missing = fixture();missing.outgoing[0].native = null;assert.throws(() => verify(missing));
  const title = fixture();title.outgoing[0].title = 'Different';assert.throws(() => verify(title));
});

test('rejects copied native initialization hooks', () => {
  const value = fixture();value.outgoing[0].initializationHooks = true;assert.throws(() => verify(value));
});

test('installed index helper retains progress before checks and keeps body read scope independent', () => {
  const begin = source.indexOf('async function gitLabReferencesEvidence(');
  const end = source.indexOf('\nasync function openReviewAncestors(', begin);
  const helper = source.slice(begin, end);
  assert.ok(helper.indexOf('item.references = progress') < helper.indexOf('assertGitLabReferenceIndex(progress.before)'));
  assert.match(helper, /progress\.snapshots\.push\(value\)/);
  assert.match(helper, /await button\.click\(\)/);
  assert.match(helper, /anchor\.parentElement === parent/);
  assert.match(helper, /document\.activeElement === anchor/);
  assert.match(helper, /progress\.requests\.push/);
  assert.doesNotMatch(helper, /assert\.deepEqual\(progress\.requests, \[\]\)/);
});
