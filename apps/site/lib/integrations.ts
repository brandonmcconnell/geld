import { SLACK_USER_SCOPES } from '@geld/review/link-resolvers/index';

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
