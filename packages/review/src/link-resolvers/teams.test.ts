import { describe, expect, it } from 'vitest';
import { relatedLinkOf, type RelatedLink } from '../related-links';
import { candidatesFor, resolverFor, type Connection, type FetchLike } from './index';
import { teamsText } from './teams';

function linkOf(href: string): RelatedLink {
  const link = relatedLinkOf({ href, text: '' });
  if (link === null) throw new Error(href);
  return link;
}

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const TEAM = '02bd9fd6-8f93-4758-87c3-1fb73740a315';
const CHANNEL = '19:a1b2c3d4e5f6@thread.tacv2';
const message = `https://teams.microsoft.com/l/message/${encodeURIComponent(CHANNEL)}/1700000000002?tenantId=${TENANT}&groupId=${TEAM}&parentMessageId=1700000000001&teamName=Eng&channelName=Releases&createdTime=1700000000002`;

const connection: Connection = {
  id: 't1',
  service: 'teams',
  label: 'Contoso',
  host: null,
  secret: 'eyJ0',
  email: null,
  account: 'ada@contoso.com',
  covers: [TENANT],
  use: { details: true, ai: false },
  expiresAt: null,
  refresh: null,
};

function graph(answers: Readonly<Record<string, { status?: number; body?: unknown }>>): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const path = url.replace('https://graph.microsoft.com/v1.0', '').replace(/\?.*$/, '');
    const key = Object.keys(answers).find((candidate) => path.endsWith(candidate)) ?? '';
    const answer = answers[key] ?? { status: 404 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  };
  return { fetch, urls };
}

const resolver = resolverFor('teams');

describe('teams', () => {
  it('reads a reply’s link as its thread: the root message, replies oldest first, the channel', async () => {
    const { fetch, urls } = graph({
      [`/channels/${encodeURIComponent(CHANNEL)}`]: { body: { displayName: 'Releases', description: null } },
      '/messages/1700000000001': { body: { createdDateTime: '2026-11-01T10:00:00Z', from: { user: { displayName: 'Ada' } }, body: { contentType: 'html', content: '<p>Ship <at id="0">Grace</at>’s fix?</p><p>It&amp;s ready</p>' } } },
      '/replies': {
        body: {
          value: [
            { createdDateTime: '2026-11-01T10:05:00Z', from: { user: { displayName: 'Bob' } }, body: { contentType: 'text', content: 'Second' } },
            { createdDateTime: '2026-11-01T10:01:00Z', from: { application: { displayName: 'Geld' } }, body: { contentType: 'text', content: 'First' } },
          ],
        },
      },
    });
    const result = await resolver?.resolve(linkOf(message), connection, fetch);
    expect(result).toMatchObject({
      status: 'ok',
      details: {
        title: 'Ship @Grace’s fix?',
        state: '2 replies',
        where: '#Releases',
        author: 'Ada',
        updatedAt: '2026-11-01T10:05:00Z',
        messages: [{ author: 'Ada', text: 'Ship @Grace’s fix?\nIt&s ready' }, { author: 'Geld', text: 'First' }, { author: 'Bob', text: 'Second' }],
      },
    });
    expect(urls[1]).toBe(`https://graph.microsoft.com/v1.0/teams/${TEAM}/channels/${encodeURIComponent(CHANNEL)}/messages/1700000000001`);
  });

  it('reads a channel link as its name, and a channel the reader is not in as no access', async () => {
    const channel = linkOf(`https://teams.microsoft.com/l/channel/${encodeURIComponent(CHANNEL)}/Releases?groupId=${TEAM}&tenantId=${TENANT}`);
    expect(await resolver?.resolve(channel, connection, graph({ [`/channels/${encodeURIComponent(CHANNEL)}`]: { body: { displayName: 'Releases', description: 'Release notes' } } }).fetch)).toMatchObject({
      status: 'ok',
      details: { title: 'Releases', body: 'Release notes' },
    });
    expect(await resolver?.resolve(channel, connection, graph({ [`/channels/${encodeURIComponent(CHANNEL)}`]: { status: 403 } }).fetch)).toEqual({ status: 'no-access' });
  });

  it('asks only the account of the link’s tenant, and leaves chats alone', () => {
    expect(candidatesFor(linkOf(message), [{ ...connection, id: 'other', covers: ['00000000-0000-0000-0000-000000000000'] }, connection]).map((candidate) => candidate.id)).toEqual(['t1']);
    expect(resolver?.reads(linkOf('https://teams.microsoft.com/l/message/19:meeting_abc@thread.v2/1700000000001?context=%7B%22contextType%22%3A%22chat%22%7D'))).toBe(false);
  });

  it('learns the tenant from the organization', async () => {
    const { fetch } = graph({ '/me': { body: { displayName: 'Ada', userPrincipalName: 'ada@contoso.com' } }, '/organization': { body: { value: [{ id: TENANT.toUpperCase(), displayName: 'Contoso' }] } } });
    expect(await resolver?.identify({ service: 'teams', label: '', host: null, secret: 'eyJ0', email: null }, fetch)).toEqual({
      ok: true,
      identity: { account: 'ada@contoso.com', covers: [TENANT], suggestedLabel: 'Contoso', host: null },
    });
  });

  it('turns message HTML into lines', () => {
    expect(teamsText('<div>a<br>b</div><p>&lt;c&gt; &quot;d&quot;&nbsp;&#39;e&#39;</p>')).toBe('a\nb\n<c> "d" \'e\'');
  });
});
