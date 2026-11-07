import { SLACK_USER_SCOPES, TEAMS_SCOPES } from '@geld/review/link-resolvers/index';

export const SUPPORT_EMAIL = 'support@geld.sh';

/** Why Geld's Slack app asks for each scope, as the Slack app listing and the integration page say it. */
export const SLACK_SCOPE_REASONS: Readonly<Record<(typeof SLACK_USER_SCOPES)[number], string>> = {
  'channels:read': 'Show the name and purpose of a public channel a pull request links to, and the channel a linked thread is in.',
  'groups:read': 'The same for private channels you are a member of.',
  'channels:history': 'Read the message a pull request links to and its thread replies, for the link’s title and its details.',
  'groups:history': 'The same for private channels you are a member of.',
  'users:read': 'Show the names of the people who wrote those messages.',
};

export const SLACK_SCOPES = SLACK_USER_SCOPES.map((scope) => ({ scope, reason: SLACK_SCOPE_REASONS[scope] }));

/** Why Geld's Microsoft Teams app asks for each delegated Graph permission. */
export const TEAMS_SCOPE_REASONS: Readonly<Record<(typeof TEAMS_SCOPES)[number], string>> = {
  offline_access: 'Keep the connection working past an hour without signing in again.',
  'User.Read': 'Know which account and organisation the connection is, to match it to links in that organisation.',
  'ChannelMessage.Read.All': 'Read the channel message a pull request links to and its replies, in teams you are a member of. Needs an admin’s consent once.',
  'Channel.ReadBasic.All': 'Show the name and description of the channel a linked message is in.',
  'Team.ReadBasic.All': 'Know which teams you are a member of.',
};

export const TEAMS_PERMISSIONS = TEAMS_SCOPES.map((scope) => ({ scope, reason: TEAMS_SCOPE_REASONS[scope] }));

/** The link a tenant admin follows to consent to Geld's Teams app for everyone in the organisation. */
export function teamsAdminConsentUrl(clientId: string): string {
  const params = new URLSearchParams({ client_id: clientId, scope: TEAMS_SCOPES.filter((scope) => scope !== 'offline_access').map((scope) => `https://graph.microsoft.com/${scope}`).join(' '), redirect_uri: 'https://www.geld.sh/connect/teams/callback' });
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${params}`;
}
