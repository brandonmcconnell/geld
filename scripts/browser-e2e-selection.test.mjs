import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workflow = readFileSync(new URL('../.github/workflows/browser-e2e.yml', import.meta.url), 'utf8');
const harness = readFileSync(new URL('../apps/extension/scripts/browser-e2e.mjs', import.meta.url), 'utf8');
const selectorJob = workflow.slice(workflow.indexOf('  select-public-verification:'), workflow.indexOf('  installed-extension:'));
const script = selectorJob.split('          script: |\n')[1].replace(/^ {12}/gm, '');
const repository = 'brandonmcconnell/geld';
const marker = (focus) => `<!-- geld-browser-focus: ${focus} -->`;

function select({ event = 'pull_request', action = 'edited', body = '', from, changes, fork = false, input, labels = [] } = {}) {
  const outputs = {};
  const logs = [];
  const failures = [];
  const payload = event === 'workflow_dispatch' ? { inputs: input === undefined ? {} : { focus: input }, pull_request: { labels: labels.map(name => ({ name })) } } : {
    action, pull_request: { head: { repo: { full_name: fork ? 'someone/fork' : repository } }, body, labels: labels.map(name => ({ name })) },
    changes: changes ?? (from === undefined ? {} : { body: { from } }),
  };
  // Execute the repository's static selector; event metadata remains data in context.payload.
  new vm.Script(script).runInNewContext({
    context: { eventName: event, payload, repo: { owner: 'brandonmcconnell', repo: 'geld' } },
    core: { setOutput: (key, value) => { outputs[key] = value; }, info: (message) => logs.push(message), setFailed: (message) => failures.push(message) },
  }, { timeout: 1000 });
  if (outputs.run === 'false') assert.ok(logs.some((message) => /No (?:public )?feature verification ran or passed\./.test(message)));
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

test('UI acceptance selects one Bitbucket continuity case without broadening defaults or budgets', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['gitlab-ui']), ['gitlab-mixed', 'gitlab-overview-digest']);
  assert.deepEqual(Array.from(cases['bitbucket-ui']), ['bitbucket-ui-continuity']);
  for (const focus of ['gitlab-ui', 'bitbucket-ui']) assert.deepEqual(select({ body: marker(focus), from: marker('github') }), { focus, run: 'true', failures: [] });
  assert.deepEqual(Array.from(cases.regression), ['gitlab-mixed', 'gitlab-all-tests', 'gitlab-overview-digest', 'github-regression', 'bitbucket-diff']);
  assert.match(harness, /conservativeObservedRequestBudget: 40/);
});

test('the literal Bitbucket list+commit slice selects exactly two cases and preserves cold-list demand', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];
  assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-list-commit']), ['bitbucket-list-counts', 'bitbucket-commit-counts']);
  assert.deepEqual(select({ body: marker('bitbucket-list-commit'), from: marker('github') }), { focus: 'bitbucket-list-commit', run: 'true', failures: [] });
  assert.match(harness, /const coldBitbucketList = \['bitbucket-list', 'bitbucket-list-commit'\]\.includes\(focus\)/);
  assert.match(harness, /coldRequired: coldBitbucketList/);
  assert.match(harness, /conservativeObservedRequestBudget: 40/);
  assert.match(harness, /name === 'bitbucket-commit-counts'\) commitSources\.set\(page, observeBitbucketCommitFixture\(page, item\)\)/);
  assert.match(harness, /const all = source\.totals/);
});

test('cross-provider settings selects one bounded case and does not broaden the default or Bitbucket slices', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];
  assert.ok(literal, 'Missing static harness focus map');
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['cross-provider-settings']), ['cross-provider-settings']);
  assert.equal(cases.regression.includes('cross-provider-settings'), false);
  for (const [focus, selected] of Object.entries(cases)) if (focus.startsWith('bitbucket-')) assert.equal(selected.includes('cross-provider-settings'), false);
  assert.match(harness, /await runCase\('cross-provider-settings', GL_MIXED, verifyCrossProviderSettings\)/);
  assert.deepEqual(select({ body: marker('cross-provider-settings'), from: marker('gitlab-review') }), { focus: 'cross-provider-settings', run: 'true', failures: [] });
});

test('GitLab whitespace characterization is one explicit literal with no default/all/regression demand', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['gitlab-whitespace-viewed']), ['gitlab-whitespace-viewed']);assert.equal(cases.regression.includes('gitlab-whitespace-viewed'), false);
  assert.deepEqual(select({ body: marker('gitlab-whitespace-viewed'), from: marker('github') }), { focus: 'gitlab-whitespace-viewed', run: 'true', failures: [] });
  assert.match(harness, /whitespacePrivacy && focus !== 'gitlab-whitespace-viewed'/);
  assert.match(harness, /await runCase\('gitlab-whitespace-viewed', GL_MIXED/);
});

test('native GitLab whitespace session has an independent literal case without weakening the legacy characterization', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['gitlab-whitespace-session']), ['gitlab-whitespace-session']);
  assert.deepEqual(Array.from(cases['gitlab-whitespace-viewed']), ['gitlab-whitespace-viewed']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'gitlab-whitespace-session') assert.equal(selected.includes('gitlab-whitespace-session'), false);
  assert.deepEqual(select({ body: marker('gitlab-whitespace-session'), from: marker('github') }), { focus: 'gitlab-whitespace-session', run: 'true', failures: [] });
  assert.deepEqual(select({ body: `${marker('gitlab-whitespace-session')}\nEvidence`, from: marker('gitlab-whitespace-session') }), { focus: 'gitlab-whitespace-session', run: 'false', failures: [] });
  assert.match(harness, /name === 'gitlab-whitespace-session' && focus !== 'gitlab-whitespace-session'/);
  assert.match(harness, /const whitespacePrivacy = \['gitlab-whitespace-viewed', 'gitlab-whitespace-session'\]\.includes\(name\)/);
});

test('unchanged cross-provider settings prose edits do not enqueue another two-provider visit', () => {
  assert.deepEqual(select({ body: `${marker('cross-provider-settings')}\nNew evidence`, from: `${marker('cross-provider-settings')}\nEarlier evidence` }), { focus: 'cross-provider-settings', run: 'false', failures: [] });
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

test('literal Bitbucket author-only focus selects one stats-off case without repeating count acquisition', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-authors']), ['bitbucket-list-authors']);
  assert.deepEqual(select({ body: marker('bitbucket-authors'), from: marker('github') }), { focus: 'bitbucket-authors', run: 'true', failures: [] });
  assert.equal(cases.regression.includes('bitbucket-list-authors'), false);
  const body = harness.slice(harness.indexOf("await runCase('bitbucket-list-authors'"), harness.indexOf("await runCase('bitbucket-comment-digest'"));
  assert.match(body, /assert\.equal\(authorSettings\.showListStats, false/);assert.match(body, /verifyBitbucketHiddenAuthors/);assert.doesNotMatch(body, /bitbucketListCounts\(/);
  assert.match(harness, /if \(name === 'bitbucket-list-counts' \|\| name === 'bitbucket-list-authors'\)/);
  assert.match(harness, /name === 'bitbucket-list-authors' && focus === 'all'/);
  assert.match(harness, /conservativeObservedRequestBudget: 40/);
});


test('native Bash discovery requires its explicit literal focus and does not broaden regression or all', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-native-bash']), ['bitbucket-native-bash-style']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'bitbucket-native-bash') assert.equal(selected.includes('bitbucket-native-bash-style'), false);
  assert.deepEqual(select({ body: marker('bitbucket-native-bash'), from: marker('github') }), { focus: 'bitbucket-native-bash', run: 'true', failures: [] });
  assert.equal(select({ body: marker('bitbucket-native-bash') + '\nUpdated prose', from: marker('bitbucket-native-bash') }).run, 'false');
  assert.deepEqual(select({ fork: true, body: marker('bitbucket-native-bash'), from: marker('github') }), { focus: 'regression', run: 'false', failures: [] });
  assert.match(harness, /name === 'bitbucket-native-bash-style' && focus !== 'bitbucket-native-bash'/);
});

test('repository commit-link acceptance is explicit only, observes before navigation and restores settings after closure', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-commit-links']), ['bitbucket-commit-links']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'bitbucket-commit-links') assert.equal(selected.includes('bitbucket-commit-links'), false);
  assert.deepEqual(select({ body: marker('bitbucket-commit-links'), from: marker('github') }), { focus: 'bitbucket-commit-links', run: 'true', failures: [] });
  assert.equal(select({ body: marker('bitbucket-commit-links') + '\nNew prose', from: marker('bitbucket-commit-links') }).run, 'false');
  assert.deepEqual(select({ fork: true, body: marker('bitbucket-commit-links'), from: marker('github') }), { focus: 'regression', run: 'false', failures: [] });
  const runner = harness.slice(harness.indexOf('async function runCase('), harness.indexOf('async function crossSettingsDom('));
  assert.match(runner, /name === 'bitbucket-commit-links' && focus !== 'bitbucket-commit-links'/);
  assert.ok(runner.indexOf('await commitLinkSettings.prepare()') < runner.indexOf('await browser.newPage()'));
  assert.ok(runner.indexOf("name === 'bitbucket-commit-links') commitSources.set(page, observeBitbucketCommitFixture(page, item))") < runner.indexOf('await page.goto(url'));
  const cleanup = runner.slice(runner.lastIndexOf('} finally {'));
  assert.ok(cleanup.indexOf('await page.close()') < cleanup.indexOf('await commitLinkSettings.restore('));
  assert.match(cleanup, /item.status = 'failed';item.cleanupError/);
  assert.match(harness, /remaining >= 8/);assert.match(harness, /conservativeObservedRequestBudget: 40/);
});


test('native GitLab file search selects one explicit immutable MR case without broadening all/default or diff', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['gitlab-file-search']), ['gitlab-file-search']);
  assert.equal(cases.regression.includes('gitlab-file-search'), false);
  assert.equal(cases['gitlab-diff'].includes('gitlab-file-search'), false);
  assert.match(harness, /name === 'gitlab-file-search' && focus !== 'gitlab-file-search'/);
  assert.match(harness, /runCase\('gitlab-file-search', GITLAB_FILE_SEARCH.url/);
  assert.deepEqual(select({ body: marker('gitlab-file-search'), from: marker('github') }), { focus: 'gitlab-file-search', run: 'true', failures: [] });
});

test('standalone GitLab whole-file acceptance is a two-case literal-only slice, observed before navigation and excluded from all/default', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  const names = ['gitlab-standalone-whole-commit', 'gitlab-standalone-whole-compare'];assert.deepEqual(Array.from(cases['gitlab-standalone-whole']), names);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'gitlab-standalone-whole') for (const name of names) assert.equal(selected.includes(name), false);
  assert.deepEqual(select({ body: marker('gitlab-standalone-whole'), from: marker('github') }), { focus: 'gitlab-standalone-whole', run: 'true', failures: [] });
  assert.equal(select({ body: `${marker('gitlab-standalone-whole')}\nNew evidence`, from: marker('gitlab-standalone-whole') }).run, 'false');
  assert.equal(select({ body: marker('gitlab-standalone-whole'), fork: true, from: marker('github') }).run, 'false');
  const runner = harness.slice(harness.indexOf('async function runCase('), harness.indexOf('async function crossSettingsDom('));
  assert.match(runner, /\['gitlab-standalone-whole-commit', 'gitlab-standalone-whole-compare'\]\.includes\(name\) && focus !== 'gitlab-standalone-whole'/);
  assert.ok(runner.indexOf('standaloneObserver = observeStandaloneWhole(') < runner.indexOf('await page.goto(url'));
  assert.match(runner, /await standaloneObserver\.dispose\(\)/);assert.match(harness, /verifyStandaloneWhole\(page, item\.standaloneWhole/);
});

test('pipeline focus selects only its explicit case and never broadens regression', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-pipeline-shell']), ['bitbucket-pipeline-shell']);assert.equal(cases.regression.includes('bitbucket-pipeline-shell'), false);
  assert.deepEqual(select({ body: marker('bitbucket-pipeline-shell'), from: marker('github') }), { focus: 'bitbucket-pipeline-shell', run: 'true', failures: [] });
  assert.equal(select({ body: `${marker('bitbucket-pipeline-shell')}\nNew prose`, from: `${marker('bitbucket-pipeline-shell')}\nOld prose` }).run, 'false');
  assert.equal(select({ body: marker('bitbucket-pipeline-shell'), fork: true, action: 'edited', from: marker('github') }).run, 'false');
});

test('native Syntax-on characterization is literal-only, fresh-window admitted and separate from Off/default/all', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-pipeline-syntax-on']), ['bitbucket-pipeline-syntax-on']);assert.equal(cases.regression.includes('bitbucket-pipeline-syntax-on'), false);assert.deepEqual(Array.from(cases['bitbucket-pipeline-shell']), ['bitbucket-pipeline-shell']);
  assert.match(harness, /name === 'bitbucket-pipeline-syntax-on' && focus !== 'bitbucket-pipeline-syntax-on'/);assert.match(harness, /syntaxOnBudgetPreflight\(active, report\.quotaPolicy\.conservativeObservedRequestBudget\)/);
  assert.ok(harness.indexOf('syntaxOnTraffic = observeSyntaxOnTraffic(page') < harness.indexOf('const response = await page.goto(url'));
  assert.match(harness, /characterizeBitbucketSyntaxOn\(page, item,/);assert.match(harness, /freshAnonymousProfile: report\.auth\.freshTemporaryBrowserProfile/);
  assert.deepEqual(select({ body: marker('bitbucket-pipeline-syntax-on'), from: marker('github') }), { focus: 'bitbucket-pipeline-syntax-on', run: 'true', failures: [] });
  assert.equal(select({ body: `${marker('bitbucket-pipeline-syntax-on')}\nNew prose`, from: `${marker('bitbucket-pipeline-syntax-on')}\nOld prose` }).run, 'false');
});


test('standalone native Bash On is a separate explicit literal and never broadens discovery or regression', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-native-bash-on']), ['bitbucket-native-bash-on']);
  assert.deepEqual(Array.from(cases['bitbucket-native-bash']), ['bitbucket-native-bash-style']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'bitbucket-native-bash-on') assert.equal(selected.includes('bitbucket-native-bash-on'), false);
  assert.deepEqual(select({ body: marker('bitbucket-native-bash-on'), from: marker('github') }), { focus: 'bitbucket-native-bash-on', run: 'true', failures: [] });
  assert.equal(select({ body: marker('bitbucket-native-bash-on') + '\nOnly prose changes', from: marker('bitbucket-native-bash-on') }).run, 'false');
  assert.deepEqual(select({ fork: true, body: marker('bitbucket-native-bash-on'), from: marker('github') }), { focus: 'regression', run: 'false', failures: [] });
  assert.match(harness, /name === 'bitbucket-native-bash-on' && focus !== 'bitbucket-native-bash-on'/);
  assert.match(harness, /nativeBashOnPreflight\(active, report.quotaPolicy.conservativeObservedRequestBudget\)/);
});

test('first-use native On has one literal focus, no default/all/regression navigation and no marker-edit churn', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];const cases = new vm.Script(`(${literal})`).runInNewContext();
  assert.deepEqual(Array.from(cases['bitbucket-pipeline-initial-on']), ['bitbucket-pipeline-initial-on']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'bitbucket-pipeline-initial-on') assert.equal(selected.includes('bitbucket-pipeline-initial-on'), false);
  assert.deepEqual(select({ body: marker('bitbucket-pipeline-initial-on'), from: marker('github') }), { focus: 'bitbucket-pipeline-initial-on', run: 'true', failures: [] });
  assert.equal(select({ body: marker('bitbucket-pipeline-initial-on') + '\nUpdated prose', from: marker('bitbucket-pipeline-initial-on') }).run, 'false');
  assert.deepEqual(select({ fork: true, body: marker('bitbucket-pipeline-initial-on'), from: marker('github') }), { focus: 'regression', run: 'false', failures: [] });
  assert.match(harness, /name === 'bitbucket-pipeline-initial-on' && focus !== 'bitbucket-pipeline-initial-on'/);
  assert.ok(harness.indexOf('await firstUseSettings.prepare()') < harness.indexOf('page = await browser.newPage()'));
  assert.match(harness, /await firstUseSettings.restore\(page === undefined \|\| page.isClosed\(\)\)/);
});

test('report-only native Settings diagnosis is one explicit literal with unchanged NativeOn selection',()=>{
 const literal=/const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];const cases=new vm.Script(`(${literal})`).runInNewContext();assert.deepEqual(Array.from(cases['bitbucket-native-settings-diagnostic']),['bitbucket-native-settings-diagnostic']);for(const[k,v]of Object.entries(cases))if(k!=='bitbucket-native-settings-diagnostic')assert.equal(v.includes('bitbucket-native-settings-diagnostic'),false);
 assert.deepEqual(select({body:marker('bitbucket-native-settings-diagnostic'),from:marker('github')}),{focus:'bitbucket-native-settings-diagnostic',run:'true',failures:[]});assert.equal(select({body:marker('bitbucket-native-settings-diagnostic')+'\nNew prose',from:marker('bitbucket-native-settings-diagnostic')}).run,'false');assert.equal(select({fork:true,body:marker('bitbucket-native-settings-diagnostic'),from:marker('github')}).run,'false');assert.match(harness,/name === 'bitbucket-native-settings-diagnostic' && focus !== 'bitbucket-native-settings-diagnostic'/);assert.match(harness,/nativeSettingsDiagnosticPreflight\(active, report.quotaPolicy.conservativeObservedRequestBudget\)/);
});


test('native file-menu research is a literal-only safe marker and never broadens default/all/regression',()=>{
 const literal=/const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];const cases=new vm.Script(`(${literal})`).runInNewContext();assert.deepEqual(Array.from(cases['bitbucket-native-file-menu']),['bitbucket-native-file-menu']);for(const[k,v]of Object.entries(cases))if(k!=='bitbucket-native-file-menu')assert.equal(v.includes('bitbucket-native-file-menu'),false);
 assert.deepEqual(select({body:marker('bitbucket-native-file-menu'),from:marker('github')}),{focus:'bitbucket-native-file-menu',run:'true',failures:[]});assert.equal(select({body:marker('bitbucket-native-file-menu')+'\nOnly prose',from:marker('bitbucket-native-file-menu')}).run,'false');assert.equal(select({fork:true,body:marker('bitbucket-native-file-menu'),from:marker('github')}).run,'false');assert.match(harness,/fileMenuPrivacy && focus !== 'bitbucket-native-file-menu'/);assert.match(harness,/nativeFileMenuPreflight\(active, report.quotaPolicy.conservativeObservedRequestBudget\)/);
});

test('GitLab shell is an independent literal-only acceptance with one pinned public fixture', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['gitlab-shell']), ['gitlab-shell']);
  for (const [focus, selected] of Object.entries(cases)) if (focus !== 'gitlab-shell') assert.equal(selected.includes('gitlab-shell'), false);
  assert.deepEqual(select({ body: marker('gitlab-shell'), from: marker('github') }), { focus: 'gitlab-shell', run: 'true', failures: [] });
  assert.deepEqual(select({ body: `${marker('gitlab-shell')}\nEvidence`, from: marker('gitlab-shell') }), { focus: 'gitlab-shell', run: 'false', failures: [] });
  assert.match(harness, /shellPrivacy && focus !== 'gitlab-shell'/);
  assert.match(harness, /await runCase\('gitlab-shell', GITLAB_SHELL.url/);
});

test('Bitbucket whole context selects one literal full-commit case and never enters other slices',()=>{
 const literal=/const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];assert.ok(literal);const cases=new vm.Script(`(${literal})`).runInNewContext({}, {timeout:1000});assert.deepEqual(Array.from(cases['bitbucket-whole-context']),['bitbucket-whole-context']);for(const[k,v]of Object.entries(cases))if(k!=='bitbucket-whole-context')assert.equal(v.includes('bitbucket-whole-context'),false);
 assert.deepEqual(select({body:marker('bitbucket-whole-context'),from:marker('github')}),{focus:'bitbucket-whole-context',run:'true',failures:[]});assert.match(harness,/wholePrivacy && focus !== 'bitbucket-whole-context'/);assert.match(harness,/await runCase\('bitbucket-whole-context', bitbucketWholeURL/);
});

test('PR whole context is a separate literal and does not select the standalone case',()=>{const literal=/const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1],cases=new vm.Script(`(${literal})`).runInNewContext({},{timeout:1000});assert.deepEqual(Array.from(cases['bitbucket-pr-whole-context']),['bitbucket-pr-whole-context']);for(const[k,v]of Object.entries(cases))if(k!=='bitbucket-pr-whole-context')assert.equal(v.includes('bitbucket-pr-whole-context'),false);assert.deepEqual(select({body:marker('bitbucket-pr-whole-context'),from:marker('github')}),{focus:'bitbucket-pr-whole-context',run:'true',failures:[]});assert.match(harness,/prWhole && focus !== 'bitbucket-pr-whole-context'/);});

test('static whitespace-source focus selects no browser job and retains its own artifact without replacing cooldown evidence',()=>{
  assert.deepEqual(select({body:marker('bitbucket-whitespace-source'),from:marker('github')}),{focus:'bitbucket-whitespace-source',run:'true',failures:[]});
  const browser=workflow.slice(workflow.indexOf('  installed-extension:'),workflow.indexOf('  bitbucket-static-source:'));
  const source=workflow.slice(workflow.indexOf('  bitbucket-static-source:'));
  assert.match(browser,/focus != 'bitbucket-whitespace-source'/);assert.match(source,/focus == 'bitbucket-whitespace-source'/);
  assert.match(source,/node apps\/extension\/scripts\/bitbucket-whitespace-source-research\.mjs --pr-dependencies/);assert.match(source,/name: geld-bitbucket-source-research/);
  assert.doesNotMatch(browser,/--retain-asset/);
  assert.doesNotMatch(source,/test:browser|build:chrome|google-chrome|geld-installed-browser-e2e|GELD_BROWSER_PREVIOUS_REPORT/);
  assert.doesNotMatch(harness,/bitbucket-whitespace-source/);
});


test('Bitbucket whitespace is a separate literal with no default/all/regression activation', () => {
  const literal = /const FOCUSED_CASES = (\{[\s\S]*?\n\});/.exec(harness)?.[1];
  const cases = new vm.Script(`(${literal})`).runInNewContext({}, { timeout: 1000 });
  assert.deepEqual(Array.from(cases['bitbucket-whitespace-session']), ['bitbucket-whitespace-session']);
  for (const [key, selected] of Object.entries(cases)) if (key !== 'bitbucket-whitespace-session') assert.equal(selected.includes('bitbucket-whitespace-session'), false);
  assert.deepEqual(select({ body: marker('bitbucket-whitespace-session'), from: marker('github') }), { focus: 'bitbucket-whitespace-session', run: 'true', failures: [] });
  assert.equal(select({ body: marker('bitbucket-whitespace-session'), from: marker('bitbucket-whitespace-session') }).run, 'false');
});

test('whitespace first activation declines before page creation when its carried forecast does not fit', async () => {
  const start = harness.indexOf('async function runBitbucketWhitespaceCase()');const end = harness.indexOf('\nasync function crossSettingsDom(', start);
  const body = harness.slice(start, end);assert.ok(body.includes('scope.prepare()'));
  for (const scenario of ['not-selected', 'held', 'budget']) {
    let created = 0, writes = 0;const report = { cases: [] };
    const globals = { assert, report, setTimeout, clearTimeout, bitbucketWhitespaceAwait: async operation => operation(), focus: scenario === 'not-selected' ? 'regression' : 'bitbucket-whitespace-session', BITBUCKET_WHITESPACE_URL: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/diff',
      AbortController, Date, cooldowns: new Map(scenario === 'held' ? [['bitbucket', Date.now() + 10000]] : []), bitbucketRequestTimes: [],
      bitbucketWhitespaceBudget: () => ({ available: false }), currentCaseAbort: undefined, saveReport: async () => {},
      browser: { newPage: async () => { created++;throw Error('Unexpected page'); } }, options: { evaluate: async () => { writes++; } },
    };
    await new vm.Script(body + ';runBitbucketWhitespaceCase()').runInNewContext(globals);
    assert.equal(created, 0);assert.equal(writes, 0);assert.equal(report.cases[0].status, scenario === 'not-selected' ? 'not_selected' : 'unavailable');
    if (scenario === 'budget') assert.equal(report.cases[0].navigationSuppressedByBudget, true);
  }
});

test('whitespace wall deadline checkpoints and closes without provider cooldown or late success', async () => {
  const start = harness.indexOf('async function runBitbucketWhitespaceCase()'), end = harness.indexOf('\nasync function crossSettingsDom(', start), body = harness.slice(start, end);
  for (const latePass of [false, true]) {
    let entered = false, closed = false, restored = false;const saves = [], timers = [], report = { cases: [] }, cooldowns = new Map();
    const page = { setViewport: async () => {}, bringToFront: async () => {}, on() {}, goto: async () => ({ status: () => 200 }), url: () => 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/diff', isClosed: () => closed, close: async () => { closed = true; } };
    const observer = { evidence: { released: false, requests: [] }, dispose: async () => { observer.evidence.released = true; } };
    const globals = { assert, report, focus: 'bitbucket-whitespace-session', BITBUCKET_WHITESPACE_URL: page.url(), AbortController, Date, cooldowns, bitbucketRequestTimes: [], currentCaseAbort: undefined, extensionId: 'installed', options: {}, WAIT_MS: 90000,
      setTimeout: (callback, ms) => { const timer = { callback, ms };timers.push(timer);return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; },
      bitbucketWhitespaceAwait: async operation => operation(), bitbucketWhitespaceBudget: () => ({ available: true }),
      saveReport: async () => { saves.push(structuredClone(report.cases[0])); }, browser: { newPage: async () => page },
      bitbucketWhitespaceSettings: () => ({ prepare: async () => {}, restore: async value => { assert.equal(value, true);restored = true;report.cases[0].settings.restored = true; } }),
      observeBitbucketBudget: (_page, item) => { item.observedBitbucketApiRequests = 3; }, observeBitbucketWhitespace: () => observer,
      providerOf: () => 'bitbucket', retryAfter: () => 0, poll: async () => {}, tabState: async () => {},
      verifyBitbucketWhitespace: async (_page, { signal, progress }) => { progress.stage = 'waiting_for_native';entered = true;return new Promise((resolve, reject) => signal.addEventListener('abort', () => latePass ? resolve({ status: 'passed' }) : reject(signal.reason), { once: true })); },
    };
    const run = new vm.Script(body + ';runBitbucketWhitespaceCase()').runInNewContext(globals);
    for (let n = 0; n < 100 && !entered; n++) await Promise.resolve();assert.equal(entered, true);
    const timer = timers.find(value => value.ms === 120000);assert.ok(timer);timer.callback();await run;
    assert.equal(report.cases[0].status, 'failed');assert.equal(report.cases[0].timeout.code, 'WHITESPACE_CASE_TIMEOUT');assert.equal(report.cases[0].timeout.observedRequests, 3);
    assert.equal(saves.some(value => value.lastCheckpoint.stage === 'case_timeout'), true);assert.equal(closed, true);assert.equal(restored, true);
    assert.equal(cooldowns.size, 0);assert.equal(report.cases[0].rateLimitedUntil, undefined);assert.equal(report.cases[0].budgetHold, undefined);
  }
});

for (const action of ['opened', 'synchronize', 'reopened', 'edited']) test(`labelled restack ${action} defers public verification without changing the selected focus`, () => {
  assert.deepEqual(select({ action, body: marker('bitbucket-pr-whole-context'), from: marker('github'), labels: ['geld:restack'] }),
    { focus: 'bitbucket-pr-whole-context', run: 'false', failures: [] });
});

test('other labels leave code-event and focus-change verification enabled', () => {
  assert.equal(select({ action: 'synchronize', body: marker('github'), labels: ['geld:restack-other'] }).run, 'true');
  assert.equal(select({ body: marker('gitlab-diff'), from: marker('github'), labels: ['review'] }).run, 'true');
});

test('an explicit dispatch remains available during a labelled restack', () => {
  assert.deepEqual(select({ event: 'workflow_dispatch', input: 'bitbucket-pr-whole-context', labels: ['geld:restack'] }),
    { focus: 'bitbucket-pr-whole-context', run: 'true', failures: [] });
});

test('the restack label guards both public jobs while preserving their original focus conditions', () => {
  const condition = name => {
    const section = workflow.slice(workflow.indexOf(`  ${name}:`));
    const expression = /^    if: (.+)$/m.exec(section)?.[1];assert.ok(expression);
    return expression.replace(/\$\{\{\s*|\s*\}\}/g, '').replace('github.event.pull_request.labels.*.name', 'labels').replaceAll('needs.select-public-verification', "needs['select-public-verification']");
  };
  for (const event_name of ['pull_request', 'workflow_dispatch']) for (const label of [false, true]) for (const run of ['false', 'true']) for (const focus of ['github', 'bitbucket-whitespace-source']) {
    const globals = { github: { event_name }, labels: label ? ['geld:restack'] : [], contains: (values, value) => values.includes(value), needs: { 'select-public-verification': { outputs: { run, focus } } } };
    const deferred = event_name === 'pull_request' && label;
    assert.equal(new vm.Script(condition('installed-extension')).runInNewContext(globals), !deferred && run === 'true' && focus !== 'bitbucket-whitespace-source');
    assert.equal(new vm.Script(condition('bitbucket-static-source')).runInNewContext(globals), !deferred && run === 'true' && focus === 'bitbucket-whitespace-source');
  }
});
