import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/browser-e2e.yml', import.meta.url), 'utf8');
const selectorJob = workflow.slice(workflow.indexOf('  select-public-verification:'), workflow.indexOf('  installed-extension:'));
const script = selectorJob.split('          script: |\n')[1].replace(/^ {12}/gm, '');
const repository = 'brandonmcconnell/geld';
const marker = (focus) => `<!-- geld-browser-focus: ${focus} -->`;

function select({ event = 'pull_request', action = 'edited', body = '', from, changes, fork = false, input } = {}) {
  const outputs = {};
  const logs = [];
  const failures = [];
  const payload = event === 'workflow_dispatch' ? { inputs: input === undefined ? {} : { focus: input } } : {
    action, pull_request: { head: { repo: { full_name: fork ? 'someone/fork' : repository } }, body },
    changes: changes ?? (from === undefined ? {} : { body: { from } }),
  };
  // Execute the repository's static selector; event metadata remains data in context.payload.
  new vm.Script(script).runInNewContext({
    context: { eventName: event, payload, repo: { owner: 'brandonmcconnell', repo: 'geld' } },
    core: { setOutput: (key, value) => { outputs[key] = value; }, info: (message) => logs.push(message), setFailed: (message) => failures.push(message) },
  }, { timeout: 1000 });
  if (outputs.run === 'false') assert.ok(logs.some((message) => message.includes('No feature verification ran or passed.')));
  return { ...outputs, failures };
}

for (const [name, event] of [
  ['same marker with prose edits', { body: `${marker('bitbucket-list')}\nNew evidence`, from: `${marker('bitbucket-list')}\nOld evidence` }],
  ['title-only edit', { body: marker('bitbucket-list'), changes: { title: { from: 'Old title' } } }],
  ['base-only edit', { body: marker('bitbucket-list'), changes: { base: { ref: { from: 'previous-base' } } } }],
  ['default body prose edit', { body: 'New evidence', from: 'Old evidence' }],
  ['explicit default marker removal', { body: '', from: marker('regression') }],
  ['missing prior body state', { body: marker('bitbucket-list') }],
  ['malformed prior body state', { body: marker('bitbucket-list'), changes: { body: { from: 42 } } }],
]) test(`${name} skips provider navigation`, () => {
  assert.equal(select(event).run, 'false');
});

test('a valid literal focus change selects that slice', () => {
  assert.deepEqual(select({ body: marker('bitbucket-list'), from: marker('gitlab-review') }), { focus: 'bitbucket-list', run: 'true', failures: [] });
});

test('removing a nondefault marker explicitly returns to regression', () => {
  assert.deepEqual(select({ body: 'Updated description', from: marker('bitbucket-list') }), { focus: 'regression', run: 'true', failures: [] });
});

test('a first valid marker after a null body runs its selected slice', () => {
  assert.equal(select({ body: marker('gitlab-review'), from: null }).run, 'true');
});

for (const focus of ['unknown', '$(touch /tmp/untrusted)', '${{ github.token }}', 'bitbucket-list -->\n<!-- geld-browser-focus: all']) {
  test(`unsupported or malformed edited marker stays closed: ${JSON.stringify(focus)}`, () => {
    assert.deepEqual(select({ body: marker(focus), from: marker('gitlab-review') }), { focus: 'regression', run: 'false', failures: [] });
  });
}

test('fork body edits cannot select a provider or enqueue a browser job', () => {
  assert.deepEqual(select({ fork: true, body: marker('bitbucket-list'), from: marker('github') }), { focus: 'regression', run: 'false', failures: [] });
});

for (const action of ['opened', 'synchronize', 'reopened']) {
  test(`${action} retains normal same-repository focus selection`, () => {
    assert.deepEqual(select({ action, body: marker('gitlab-review') }), { focus: 'gitlab-review', run: 'true', failures: [] });
  });
  test(`${action} ignores fork focus metadata and retains regression`, () => {
    assert.deepEqual(select({ action, fork: true, body: marker('bitbucket-list') }), { focus: 'regression', run: 'true', failures: [] });
  });
}

const dispatchChoices = [...workflow.matchAll(/^          - ([a-z-]+)$/gm)].map((match) => match[1]);
for (const input of dispatchChoices) test(`dispatch allowlist accepts ${input}`, () => {
  assert.deepEqual(select({ event: 'workflow_dispatch', input }), { focus: input, run: 'true', failures: [] });
});

test('dispatch defaults to regression', () => {
  assert.deepEqual(select({ event: 'workflow_dispatch' }), { focus: 'regression', run: 'true', failures: [] });
});

test('invalid dispatch fails without provider navigation', () => {
  const result = select({ event: 'workflow_dispatch', input: '$(touch /tmp/untrusted)' });
  assert.equal(result.run, 'false');
  assert.equal(result.failures.length, 1);
});

test('unrecognized events remain closed', () => {
  assert.equal(select({ event: 'issue_comment' }).run, 'false');
});

test('selector has no checkout, shell, repository import or metadata interpolation', () => {
  assert.equal((selectorJob.match(/uses:/g) ?? []).length, 1);
  assert.match(selectorJob, /uses: actions\/github-script@v9/);
  assert.doesNotMatch(script, /\$\{\{|\b(?:eval|Function|require|import)\s*\(/);
  assert.doesNotMatch(selectorJob, /actions\/checkout|^\s+run: \|/m);
});

test('only selected installed jobs enter the shared queue', () => {
  assert.equal((workflow.match(/^\s*concurrency:/gm) ?? []).length, 1);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('jobs:')), /concurrency:/);
  const browser = workflow.slice(workflow.indexOf('  installed-extension:'));
  assert.match(browser, /needs: select-public-verification/);
  assert.match(browser, /if: needs\.select-public-verification\.outputs\.run == 'true'/);
  assert.match(browser, /concurrency:\n      group: geld-installed-browser-public-providers\n      cancel-in-progress: false/);
  assert.match(browser, /GELD_BROWSER_FOCUS: \$\{\{ needs\.select-public-verification\.outputs\.focus \}\}/);
});
