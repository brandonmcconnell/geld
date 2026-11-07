import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SLACK_USER_SCOPES } from '@geld/review/link-resolvers/index';
import { SLACK_SCOPES } from './integrations';

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
