import { describe, expect, it } from 'vitest';
import { firstSentence } from './cluster';
import { createNativePublication } from './native-publication';
import { buildProviderReviewItems } from './provider-review';
import type { ProviderReviewInput } from './provider-review';

const badge = (level: '1' | '2'): string => `<a href="#"><img alt="P${level}" src="https://greptile-static-assets.s3.amazonaws.com/badges/p${level}.svg?v=9" height="20" align="top"></a>`;
// Reduced actual GitLab !272 notes 3381334872 and 3384406925, retained by run41359118677.
const concern = 'Using a branch name as `rev` makes the `pyproject.toml` entry point at a mutable ref.';
const heading = '**Missing transitive dependency for git-sourced plugin**';
const fix = 'insta360 = {git = "https://gitlab.com/whitebox-aero/insta360", rev = "8d6fdc4acb176faf2b4449f5be90af59d4390372"}';
const body = `${badge('2')} ${concern} If anyone force-pushes the branch, the dependency can change.\n\n\`\`\`suggestion\n${fix}\n\`\`\``;

function input(): ProviderReviewInput {
  const url = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
  return { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: '272', headSha: '5da09f9e31ad0d59c6f804a71380992955d1040f' }, threads: [{
    id: 'd'.repeat(40), anchor: `discussion_${'d'.repeat(40)}`, url: `${url}#note_3381334872`, path: 'backend/pyproject.toml', line: 56, resolved: true, outdated: false, stateKnown: true,
    comments: [{ id: '3381334872', anchor: 'note_3381334872', url: `${url}#note_3381334872`, author: { id: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', automated: true }, body, createdAt: '2026-11-01T12:00:00Z' }],
  }] };
}

describe('observed decorative review badge titles', () => {
  it('retains the actual same-line concern and explicit bold title with existing inline marks', () => {
    expect(firstSentence(body)).toBe(concern);
    expect(firstSentence(`${badge('1')} ${heading}\n\nThe old lockfile entry explicitly declared a dependency.`)).toBe(heading);
    expect(firstSentence(body)).toBe(firstSentence(concern));
    expect(firstSentence(`${badge('1')} ${heading}`)).toBe(firstSentence(heading));
  });

  it.each([
    badge('2'), `${badge('2')} ** **`, `${badge('2')} <details><summary>Boilerplate</summary></details>`,
    `${badge('1')} <table><tr><td>Boilerplate</td></tr></table>`, `${badge('2')} <script>alert('bad')</script>`,
    `<details><summary>${concern}</summary></details>`, `<table><tr><td>${concern}</td></tr></table>`, `<script>${concern}</script>`,
    `${badge('2').replace('href="#"', 'href="https://example.com"')} ${concern}`,
    `${badge('2').replace('alt="P2"', 'alt="P1"')} ${concern}`,
    `${badge('2').replace('greptile-static-assets.s3.amazonaws.com', 'evil.example')} ${concern}`,
    `${badge('2').replace('<img ', '<img onerror="alert(1)" ')} ${concern}`,
    `<a href="#">Actual link text</a> ${concern}`,
  ])('leaves unknown HTML and control/markup-only lines excluded: %s', (line) => {
    expect(firstSentence(line)).toBe('Comment');
    expect(firstSentence(`${line}\n\nActual later concern.`)).toBe('Actual later concern.');
  });

  it('preserves ordinary Markdown and skips fenced source suggestions rather than exposing markup', () => {
    expect(firstSentence(`\`\`\`suggestion\n${badge('2')} Fake code title.\n\`\`\`\n\nActual concern.`)).toBe('Actual concern.');
    expect(firstSentence('Check **response** and `config.resolve` first.')).toBe('Check **response** and `config.resolve` first.');
  });

  it('does not change raw bodies, native sources/status/fix/severity or infer a bot binding', async () => {
    const native = input();const before = JSON.stringify(native);
    const [unbound] = buildProviderReviewItems(native);
    const [bound] = buildProviderReviewItems({ ...native, bots: [{ id: 'greptile', authorId: '37628862' }] });
    if (unbound === undefined || bound === undefined) throw new Error('Missing finding.');
    expect(unbound).toMatchObject({ title: concern, status: 'resolved', severity: 'suggestion', fix: { source: 'bot', text: fix } });
    expect(unbound.sources[0]).toMatchObject({ anchor: 'note_3381334872', sourceId: '3381334872', authorId: '37628862', author: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b' });
    expect(unbound.sources[0]?.bot).toBeUndefined();expect(bound.sources[0]?.bot).toBe('greptile');
    expect(bound.id).toBe(unbound.id);expect(bound.title).toBe(unbound.title);expect(bound.severity).toBe(unbound.severity);
    const proof = await createNativePublication(native, [unbound]);
    expect(proof.items).toHaveLength(1);
    expect(await createNativePublication(native, [{ ...unbound, title: 'Comment' }])).toEqual(proof);
    expect(JSON.stringify(native)).toBe(before);
  });
});
