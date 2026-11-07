import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SLACK_USER_SCOPES, TEAMS_SCOPES } from '@geld/review/link-resolvers/index';
import { SLACK_SCOPES, TEAMS_PERMISSIONS, teamsAdminConsentUrl } from './integrations';

const manifest: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../integrations/slack/manifest.json', import.meta.url)), 'utf8'));

describe('the Slack app', () => {
  it('asks Slack for exactly the scopes the extension uses, each with a reason, and no bot scopes', () => {
    expect(manifest).toMatchObject({ oauth_config: { scopes: { user: [...SLACK_USER_SCOPES] }, redirect_urls: ['https://www.geld.sh/connect/slack/callback'] } });
    expect(manifest).not.toHaveProperty('oauth_config.scopes.bot');
    expect(SLACK_SCOPES.map(({ scope }) => scope)).toEqual([...SLACK_USER_SCOPES]);
    for (const { reason } of SLACK_SCOPES) expect(reason.length).toBeGreaterThan(20);
  });

  it('keeps the listing within Slack’s limits', () => {
    expect(manifest).toHaveProperty('display_information.long_description');
    const long = JSON.stringify(manifest).match(/"long_description":"([^"]*)"/)?.[1] ?? '';
    expect(long.length).toBeGreaterThanOrEqual(175);
    expect(long.length).toBeLessThanOrEqual(4000);
  });
});

describe('the Teams app', () => {
  it('gives every delegated permission a reason, and the admin consent link asks for Graph’s', () => {
    expect(TEAMS_PERMISSIONS.map(({ scope }) => scope)).toEqual([...TEAMS_SCOPES]);
    const consent = new URL(teamsAdminConsentUrl('app-id'));
    expect(consent.searchParams.get('client_id')).toBe('app-id');
    expect(consent.searchParams.get('scope')).toBe('https://graph.microsoft.com/User.Read https://graph.microsoft.com/ChannelMessage.Read.All https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/Team.ReadBasic.All');
  });
});
