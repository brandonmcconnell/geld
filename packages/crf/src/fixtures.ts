import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface Fixture {
  readonly name: string;
  readonly valid: boolean;
  readonly value: unknown;
}

const HEAD = '4b1e9d0c7a2f1e3d5c6b7a8f9e0d1c2b3a4f5e6d';
const BASE = '9f0e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e';

export const EXAMPLE_SUMMARY = {
  schema: 'crf/v0',
  bot: { name: 'Greptile', app: 'greptile-apps' },
  kind: 'summary',
  run: {
    id: 'rv_8f2c',
    state: 'completed',
    headSha: HEAD,
    sequence: 3,
    startedAt: '2026-10-16T07:20:11Z',
    completedAt: '2026-10-16T07:24:40Z',
    trigger: { type: 'comment', commentId: 2410000000, by: 'branmcconnell' },
  },
  result: {
    verdict: 'findings',
    score: { value: 4, max: 5 },
    counts: { medium: 1, low: 1 },
    findings: [
      {
        id: 'f1',
        title: 'Missing null check before `user.id`',
        severity: 'medium',
        category: 'bug',
        location: { path: 'src/auth.ts', line: 42, side: 'RIGHT' },
        commentId: 2410000123,
      },
      { id: 'f2', title: 'Unused import', severity: 'low', location: { path: 'src/util.ts', line: 3 } },
    ],
  },
  links: {
    view: { type: 'url', url: 'https://app.greptile.com/review/123' },
    rerun: { type: 'comment', body: '@greptileai' },
  },
} as const;

export const EXAMPLE_FINDING = {
  schema: 'crf/v0',
  bot: { name: 'Greptile', app: 'greptile-apps' },
  kind: 'finding',
  run: { id: 'rv_8f2c' },
  finding: {
    id: 'f1',
    title: 'Missing null check before `user.id`',
    severity: 'medium',
    location: { path: 'src/auth.ts', line: 42, side: 'RIGHT' },
  },
} as const;

export const EXAMPLE_STATUS = {
  schema: 'crf/v0',
  bot: { name: 'CodeRabbit', app: 'coderabbitai' },
  kind: 'status',
  run: { id: 'rv_91aa', state: 'running', headSha: HEAD, scope: 'incremental', coverage: { from: BASE, to: HEAD } },
} as const;

export const EXAMPLE_REFUSAL = {
  schema: 'crf/v0',
  bot: { name: 'Bugbot', app: 'cursor' },
  kind: 'refusal',
  run: { id: 'rv_77d0', state: 'refused', headSha: HEAD },
  refusal: { code: 'quota', message: 'Usage limit reached', retryable: false },
  links: { settings: { type: 'url', url: 'https://cursor.com/dashboard' } },
} as const;

const EXAMPLE_REPLY = { schema: 'crf/v0', bot: { name: 'Devin' }, kind: 'reply' } as const;

/** The conformance suite: a schema that agrees with every `valid` here accepts and rejects what the spec does. */
export const FIXTURES: readonly Fixture[] = [
  { name: 'summary', valid: true, value: EXAMPLE_SUMMARY },
  { name: 'summary of a running run, no result yet', valid: true, value: { ...EXAMPLE_SUMMARY, run: { id: 'rv_1', state: 'running', headSha: HEAD }, result: undefined } },
  { name: 'finding on a thread comment', valid: true, value: EXAMPLE_FINDING },
  { name: 'status', valid: true, value: EXAMPLE_STATUS },
  { name: 'refusal', valid: true, value: EXAMPLE_REFUSAL },
  { name: 'reply', valid: true, value: EXAMPLE_REPLY },
  { name: 'security track, superseded', valid: true, value: { ...EXAMPLE_STATUS, run: { ...EXAMPLE_STATUS.run, track: 'security', state: 'superseded' } } },
  { name: 'gate and risk', valid: true, value: { ...EXAMPLE_SUMMARY, result: { verdict: 'clean', risk: 'minimal', gate: { blocking: false, threshold: 'critical' } } } },
  { name: 'unknown fields are ignored', valid: true, value: { ...EXAMPLE_REPLY, vendor: { anything: true } } },
  { name: 'refusal without a refusal', valid: false, value: { ...EXAMPLE_REFUSAL, refusal: undefined } },
  { name: 'vendor severity in the severity field', valid: false, value: { ...EXAMPLE_FINDING, finding: { ...EXAMPLE_FINDING.finding, severity: 'P1' } } },
  { name: 'short head SHA', valid: false, value: { ...EXAMPLE_STATUS, run: { ...EXAMPLE_STATUS.run, headSha: 'abc123' } } },
  { name: 'another version', valid: false, value: { ...EXAMPLE_STATUS, schema: 'crf/v1' } },
  { name: 'unknown kind', valid: false, value: { ...EXAMPLE_REPLY, kind: 'walkthrough' } },
  { name: 'empty rerun comment', valid: false, value: { ...EXAMPLE_REPLY, links: { rerun: { type: 'comment', body: '' } } } },
  { name: 'view as a comment', valid: false, value: { ...EXAMPLE_REPLY, links: { view: { type: 'comment', body: 'see' } } } },
  { name: 'location without a path', valid: false, value: { ...EXAMPLE_FINDING, finding: { ...EXAMPLE_FINDING.finding, location: { line: 3 } } } },
  { name: 'confidence above 1', valid: false, value: { ...EXAMPLE_FINDING, finding: { ...EXAMPLE_FINDING.finding, confidence: 1.5 } } },
  { name: 'missing bot', valid: false, value: { schema: 'crf/v0', kind: 'reply' } },
];

/** Runs the fixtures through any Standard Schema and names each one it disagrees with the spec on. An empty list means it conforms. */
export async function checkConformance(schema: StandardSchemaV1, fixtures: readonly Fixture[] = FIXTURES): Promise<string[]> {
  const mismatches: string[] = [];
  for (const fixture of fixtures) {
    const result = await schema['~standard'].validate(fixture.value);
    const accepted = result.issues === undefined;
    if (accepted !== fixture.valid) mismatches.push(`${fixture.name}: expected ${fixture.valid ? 'valid' : 'invalid'}`);
  }
  return mismatches;
}
