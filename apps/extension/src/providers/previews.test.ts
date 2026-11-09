import { expect, it } from 'vitest';
import { latestPreviews } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { providerPreviewDestination, providerPreviews } from './previews';

const input: ProviderReviewInput = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [] };
const table = '| Project | Deployment | Preview | Updated |\n| --- | --- | --- | --- |\n| [site](https://vercel.com/team/site) | [Ready](https://vercel.com/team/site/abc) | [Preview](https://site-abc.vercel.app) | 2026-11-09T12:00:00Z |';
function comment(id: string, body: string, createdAt: string): ProviderReviewComment { return { id, anchor: `note_${id}`, url: `https://gitlab.com/group/project/-/merge_requests/1#note_${id}`, author: { id: 'native-automation', login: 'group_project_bot', automated: true }, body, createdAt }; }

it('parses Vercel project rows without substituting GitHub bot logins', () => {
  const previews = providerPreviews(input, [comment('1', table, '2026-11-09T12:01:00Z')]);
  expect(previews).toHaveLength(1);expect(previews[0]).toMatchObject({ project: 'site', status: 'ready', url: 'https://site-abc.vercel.app', host: 'native-account:native-automation:vercel', updatedAt: '2026-11-09T12:00:00.000Z' });
});

it('keeps a later failure and offers the earlier successful build only for the latest row', () => {
  const previews = providerPreviews(input, [comment('1', table, '2026-11-09T12:00:00Z'), comment('2', 'Deployment failed for project site with the following error:\nToo many requests', '2026-11-09T13:00:00Z')]);
  const latest = latestPreviews(previews).latest[0];if (latest === undefined) throw new Error('Missing preview');
  expect(latest).toMatchObject({ status: 'failed', reason: 'Vercel rate limited this deployment' });
  expect(providerPreviewDestination(latest, previews, true)).toEqual({ href: 'https://site-abc.vercel.app', label: 'Open last successful preview' });
  expect(providerPreviewDestination(latest, previews, false)).toBeNull();
});

it('does not infer automation from an alias and rejects another review as a source', () => {
  const source = comment('1', table, '2026-11-09T12:00:00Z');
  expect(providerPreviews(input, [{ ...source, author: { id: 'human', login: 'vercel[bot]' } }])).toEqual([]);
  expect(providerPreviews(input, [{ ...source, url: source.url.replace('/1#', '/2#') }])).toEqual([]);
  const sanitized = providerPreviews(input, [{ ...source, body: table.replace('https://site-abc.vercel.app', 'javascript:alert(1)') }]);
  expect(sanitized).toHaveLength(1);
  expect(sanitized[0]).toMatchObject({ url: null, inspectUrl: 'https://vercel.com/team/site/abc' });
});

it('keeps successful fallbacks within one observed account and project', () => {
  const source = comment('1', table, '2026-11-09T12:00:00Z');
  const failed = { ...comment('2', 'Deployment failed for project site with the following error:\nBroken config', '2026-11-09T13:00:00Z'), author: { ...source.author, id: 'different-account' } };
  const previews = providerPreviews(input, [source, failed]);
  const failure = previews.find(preview => preview.status === 'failed');if (failure === undefined) throw new Error('Missing failure');
  expect(providerPreviewDestination(failure, previews, true)).toBeNull();
});

it('selects the last successful deployment by its row time rather than its comment edit time', () => {
  const older = comment('1', table.replaceAll('site-abc', 'site-older'), '2026-11-09T15:00:00Z');
  const newer = comment('2', table.replace('12:00:00Z', '13:00:00Z'), '2026-11-09T13:01:00Z');
  const failure = comment('3', 'Deployment failed for project site with the following error:\nBroken config', '2026-11-09T14:00:00Z');
  const previews = providerPreviews(input, [older, newer, failure]);
  const latest = latestPreviews(previews).latest[0];if (latest === undefined) throw new Error('Missing preview');
  expect(latest.status).toBe('failed');
  expect(providerPreviewDestination(latest, previews, true)).toEqual({ href: 'https://site-abc.vercel.app', label: 'Open last successful preview' });
});

it('uses an explicit Bitbucket native-account binding without inventing an automation flag', () => {
  const subject = { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/project', id: '2', headSha: 'a'.repeat(40) } as const;
  const author = { id: '{12345678-1234-1234-1234-123456789abc}', login: 'workspace-deploy' };
  const source = { ...comment('7', table, '2026-11-09T12:01:00Z'), author, anchor: 'comment-7', url: 'https://bitbucket.org/workspace/project/pull-requests/2#comment-7' };
  expect(providerPreviews({ subject, threads: [] }, [source])).toEqual([]);
  expect(providerPreviews({ subject, threads: [], bots: [{ id: 'vercel', authorId: author.id }] }, [source])).toHaveLength(1);
});

it('does not promote a review finding with a shell pipeline into a linkless deployment preview', () => {
  const source = comment('8', 'Missing transitive dependency.\nIf the sandbox install script (`curl ... | sudo bash`) does not pass --with plugins-temporary to poetry install, the sandbox deploy will silently break the plugin.', '2026-11-09T12:00:00Z');
  expect(providerPreviews({ ...input, bots: [{ id: 'greptile', authorId: source.author.id }] }, [source])).toEqual([]);
});

it('retains linkless deployment status only with an explicit native service binding', () => {
  const source = comment('9', 'Deploying site with Cloudflare Pages\nStatus: Building', '2026-11-09T12:00:00Z');
  expect(providerPreviews(input, [source])).toEqual([]);
  expect(providerPreviews({ ...input, bots: [{ id: 'cloudflare', authorId: source.author.id }] }, [source])).toMatchObject([{ project: 'site', status: 'building' }]);
});
