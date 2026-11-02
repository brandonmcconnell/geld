import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { readProviderCiConfig } from './config';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw Error('Expected a YAML mapping.');return value; }
function strings(value: unknown): readonly string[] { if (!Array.isArray(value) || !value.every((entry: unknown): entry is string => typeof entry === 'string')) throw Error('Expected a YAML string array.');return value; }
function yaml(path: string): Record<string, unknown> {
  const doc = parseDocument(readFileSync(new URL(path, import.meta.url), 'utf8'), { uniqueKeys: true });
  expect(doc.errors).toEqual([]);const value: unknown = doc.toJS();return record(value);
}
const template = yaml('../../templates/gitlab-summary.yml');
const job = record(template['geld-summary']);
const example = yaml('../../examples/gitlab-ci.yml');
function rules(value: unknown): readonly Record<string, unknown>[] { if (!Array.isArray(value)) throw Error('Expected rule array.');return value.map(record); }
const env = { CI_DEFAULT_BRANCH: 'main', CI_COMMIT_BRANCH: 'main', CI_COMMIT_REF_PROTECTED: 'true', CI_PIPELINE_SOURCE: 'trigger', GELD_REPOSITORY: 'group/subgroup/project', GELD_REVIEW_NUMBER: '42' };

// A bounded interpreter for this template's documented rules subset, not GitLab CI-lint.
// Values stay in an environment map: hostile strings never become expression/script text.
function condition(source: string, values: Readonly<Record<string, string | undefined>>): boolean {
  const tokens: string[] = [];const token = /\s*(\$[A-Z_]+|"[^"]*"|\/(?:\\.|[^/])+\/|&&|\|\||==|=~|\(|\))/y;let offset = 0;
  while (offset < source.length) { token.lastIndex = offset;const match = token.exec(source);if (match?.[1] === undefined) throw Error('Unsupported rule expression.');tokens.push(match[1]);offset = token.lastIndex; }
  let at = 0;
  const take = (): string => { const value = tokens[at++];if (value === undefined) throw Error('Incomplete rule.');return value; };
  const value = (name: string): string => name.startsWith('$') ? values[name.slice(1)] ?? '' : name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : (() => { throw Error('Expected native variable or quoted string.'); })();
  const atom = (): boolean => {
    const left = take();if (left === '(') { const result = or();if (take() !== ')') throw Error('Unbalanced rule.');return result; }
    const actual = value(left), operator = tokens[at];
    if (operator === '==' || operator === '=~') { at++;const right = take();if (operator === '==') return actual === value(right);if (!right.startsWith('/') || !right.endsWith('/')) throw Error('Expected literal regex.');const pattern = right.slice(1, -1);if (!pattern.startsWith('^') || !pattern.endsWith('$')) throw Error('Only this template’s full-string regex subset is modeled.');const match = new RegExp(pattern).exec(actual);return match !== null && match[0].length === actual.length; }
    return actual !== '';
  };
  const and = (): boolean => { let result = atom();while (tokens[at] === '&&') { at++;const right = atom();result = result && right; }return result; };
  const or = (): boolean => { let result = and();while (tokens[at] === '||') { at++;const right = and();result = result || right; }return result; };
  const result = or();if (at !== tokens.length) throw Error('Trailing native rule tokens.');return result;
}
function selected(config: Record<string, unknown>, values: Readonly<Record<string, string | undefined>>): boolean {
  for (const rule of rules(config.rules)) {
    if (rule.if === undefined || typeof rule.if === 'string' && condition(rule.if, values)) return rule.when !== 'never';
  }
  return false;
}
// Deliberately unresolvable test-only identity; no image is published or pulled by these tests.
const fixtureImage = `registry.example.invalid/test-only/geld@sha256:${'a'.repeat(64)}`;
const installed: Record<string, unknown> = { ...job, image: { name: fixtureImage, entrypoint: [''] }, rules: rules(job.rules).slice(1) };
function literalImage(config: Record<string, unknown>): void {
  const image = record(config.image);expect(image.entrypoint).toEqual(['']);
  expect(image.name).toBeTypeOf('string');if (typeof image.name !== 'string') throw Error('Missing image.');
  expect(image.name).toMatch(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);expect(image.name).not.toContain('$');
}

describe('ordinary GitLab summary template', () => {
  it('uses a copied local include and ships no selectable job or invented image', () => {
    expect(Object.keys(example)).toEqual(['include']);expect(example.include).toEqual([{ local: '/.gitlab/ci/geld-summary.yml' }]);
    const instructions = readFileSync(new URL('../../PROVIDERS.md', import.meta.url), 'utf8');expect(instructions).toContain('REVIEWED_FULL_COMMIT:apps/action/templates/gitlab-summary.yml > .gitlab/ci/geld-summary.yml');
    expect(Object.keys(template)).toEqual(['geld-summary']);expect(job).not.toHaveProperty('image');expect(rules(job.rules)[0]).toEqual({ when: 'never' });
    for (const values of [env, {}, { ...env, GELD_TRUSTED_IMAGE: fixtureImage }, { ...env, CI_PIPELINE_SOURCE: 'web' }, { ...env, GELD_REPOSITORY: 'g/p;touch${IFS}/tmp/proof' }]) expect(selected(job, values)).toBe(false);
  });
  it('runs exactly the prebuilt literal entrypoint, with no target interpolation or inherited checkout/hooks/cache/artifacts', () => {
    expect(strings(job.script)).toEqual(['node /geld/provider.cjs']);expect(job.variables).toEqual({ GIT_STRATEGY: 'none', GELD_PROVIDER: 'gitlab' });
    expect(job.inherit).toEqual({ default: false, variables: false });expect(job.before_script).toEqual([]);expect(job.after_script).toEqual([]);expect(job.hooks).toEqual({ pre_get_sources_script: [] });expect(job.cache).toEqual([]);expect(job.dependencies).toEqual([]);
    for (const key of ['extends', 'needs', 'services', 'artifacts', 'trigger']) expect(job).not.toHaveProperty(key);
  });
  it('models the installed protected default-branch rule without treating source names as caller authorization', () => {
    literalImage(installed);for (const source of ['web', 'api', 'trigger', 'pipeline']) expect(selected(installed, { ...env, CI_PIPELINE_SOURCE: source })).toBe(true);
    for (const values of [{ CI_COMMIT_BRANCH: 'feature' }, { CI_COMMIT_REF_PROTECTED: 'false' }, { CI_DEFAULT_BRANCH: '' }, { CI_COMMIT_BRANCH: '' }, { CI_PIPELINE_SOURCE: 'merge_request_event' }, { CI_PIPELINE_SOURCE: 'push' }, { CI_PIPELINE_SOURCE: 'schedule' }, { GELD_REPOSITORY: '' }, { GELD_REVIEW_NUMBER: '' }]) expect(selected(installed, { ...env, ...values })).toBe(false);
  });
  it.each(['group/project name', 'group/project"', "group/project'", 'group/project\nnext', 'group/project\n', ' group/project', 'group/$(touch${IFS}proof)', 'group/project;touch', 'group/`id`', 'group/../project', 'group//project', 'group/project%2Fother', 'group/project\\other'])('rejects hostile/noncanonical target path %j before job selection', (repository) => {
    expect(selected(installed, { ...env, GELD_REPOSITORY: repository })).toBe(false);expect(strings(installed.script)).toEqual(['node /geld/provider.cjs']);
  });
  it.each(['0', '-1', '1 2', '42;id', '$(id)', '42\n43', '42"', "42'"])('rejects hostile review number %j in both job selection and existing runner configuration', (number) => {
    expect(selected(installed, { ...env, GELD_REVIEW_NUMBER: number })).toBe(false);
    expect(() => readProviderCiConfig({ ...env, GELD_PROVIDER: 'gitlab', GELD_REVIEW_NUMBER: number, GELD_TOKEN: 'test-only-secret' })).toThrow('positive native review number');
  });
  it('retains existing runner path validation as a separate boundary and treats shell punctuation as data', () => {
    for (const repository of ['group/path with spaces', 'group/path\nnext', 'group/../path', 'group/path?other', 'group/path%2Fother']) expect(() => readProviderCiConfig({ ...env, GELD_PROVIDER: 'gitlab', GELD_REPOSITORY: repository, GELD_TOKEN: 'test-only-secret' })).toThrow();
    const punctuation = 'group/project;literal';expect(readProviderCiConfig({ ...env, GELD_PROVIDER: 'gitlab', GELD_REPOSITORY: punctuation, GELD_TOKEN: 'test-only-secret' }).repository).toBe(punctuation);
    expect(selected(installed, { ...env, GELD_REPOSITORY: punctuation })).toBe(false);expect(strings(installed.script)).toEqual(['node /geld/provider.cjs']);
  });
  it('refuses whitespace-only shape changes at selection without changing the existing runner trimming contract', () => {
    expect(selected(installed, { ...env, GELD_REVIEW_NUMBER: '42\n' })).toBe(false);
    expect(readProviderCiConfig({ ...env, GELD_PROVIDER: 'gitlab', GELD_REVIEW_NUMBER: '42\n', GELD_TOKEN: 'test-only-secret' }).number).toBe('42');
  });
  it('checks the literal installed-image contract without pretending caller edits are enforced by the template', () => {
    literalImage(installed);
    for (const name of ['$GELD_TRUSTED_IMAGE', 'registry.example.invalid/test-only/geld:latest', `registry.example.invalid/test-only/geld@sha256:${'a'.repeat(63)}`]) expect(() => literalImage({ ...installed, image: { name, entrypoint: [''] } })).toThrow();
  });
  it('serializes the same full repository/review while keeping different target identities separate', () => {
    const group = job.resource_group;if (typeof group !== 'string') throw Error('Missing resource group.');
    expect(group).toBe('geld-summary-$GELD_REPOSITORY-$GELD_REVIEW_NUMBER');
    const key = (repository: string, number: string): string => group.replace('$GELD_REPOSITORY', repository).replace('$GELD_REVIEW_NUMBER', number);
    expect(key('g/a', '42')).toBe(key('g/a', '42'));expect(new Set([key('g/a', '42'), key('g/b', '42'), key('g/a', '43'), key('g/sub/a', '42')]).size).toBe(4);
  });
});
