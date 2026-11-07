import type { ServiceId } from '@geld/review/link-resolvers/index';

/** One field of a service's "Add account" form. */
export interface ServiceField {
  readonly label: string;
  readonly placeholder: string;
  readonly help: string | null;
  readonly required: boolean;
}

/** How the options page offers a service: a pasted key, or a sign-in through Geld's app for it. */
export interface ServiceSpec {
  readonly id: ServiceId;
  readonly name: string;
  readonly kind: 'key' | 'app';
  /** What the service reads and why it is worth connecting, one sentence. */
  readonly blurb: string;
  readonly key: ServiceField & { readonly url: string | null };
  readonly host: ServiceField | null;
  readonly email: ServiceField | null;
}

export const KEY_SERVICES: readonly ServiceSpec[] = [
  {
    id: 'linear',
    name: 'Linear',
    kind: 'key',
    blurb: 'Issue, project and document titles and states. One key per workspace.',
    key: { label: 'Personal API key', placeholder: 'lin_api_…', help: 'Linear → Settings → Security & access → Personal API keys. Read access is enough.', required: true, url: 'https://linear.app/settings/account/security' },
    host: null,
    email: null,
  },
  {
    id: 'jira',
    name: 'Jira',
    kind: 'key',
    blurb: 'Issue titles, statuses and descriptions, on Jira Cloud or your own Jira.',
    key: { label: 'API token', placeholder: 'ATATT…', help: 'For Jira Cloud, an Atlassian API token. For a self-hosted Jira, a personal access token, with the email left empty.', required: true, url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    host: { label: 'Site', placeholder: 'acme.atlassian.net', help: null, required: true },
    email: { label: 'Atlassian account email', placeholder: 'you@acme.dev', help: 'Jira Cloud only.', required: false },
  },
  {
    id: 'github',
    name: 'GitHub',
    kind: 'key',
    blurb: 'For an account this browser is not signed in to, or another Enterprise host. GitHub links on the page you are reading already show their titles.',
    key: { label: 'Personal access token', placeholder: 'github_pat_…', help: 'A fine-grained token with read access to issues, pull requests and discussions, or a classic token with `repo`.', required: true, url: 'https://github.com/settings/personal-access-tokens' },
    host: { label: 'Host', placeholder: 'github.com', help: 'Leave empty for github.com.', required: false },
    email: null,
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    kind: 'key',
    blurb: 'Issue and merge request titles and states, on gitlab.com or your own GitLab.',
    key: { label: 'Personal access token', placeholder: 'glpat-…', help: 'The `read_api` scope is enough.', required: true, url: 'https://gitlab.com/-/user_settings/personal_access_tokens' },
    host: { label: 'Host', placeholder: 'gitlab.com', help: 'Leave empty for gitlab.com.', required: false },
    email: null,
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    kind: 'key',
    blurb: 'Pull request and issue titles and states.',
    key: { label: 'API token', placeholder: 'ATATT…', help: 'An Atlassian API token with Bitbucket’s read scopes for repositories, pull requests and issues.', required: true, url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    host: null,
    email: { label: 'Atlassian account email', placeholder: 'you@acme.dev', help: 'Or your Bitbucket username with an app password.', required: true },
  },
];

export function serviceSpec(id: ServiceId): ServiceSpec | null {
  return KEY_SERVICES.find((spec) => spec.id === id) ?? null;
}

/** A service connected by signing in through Geld's own app for it, rather than a pasted key. */
export interface AppServiceSpec {
  readonly id: ServiceId;
  readonly name: string;
  readonly blurb: string;
  readonly connectLabel: string;
  readonly anotherLabel: string;
  /** Said while this build has no app for the service yet. */
  readonly pending: string;
}

export const APP_SERVICES: readonly AppServiceSpec[] = [
  {
    id: 'slack',
    name: 'Slack',
    blurb: 'Thread titles and their messages, read as you: only channels you are in, never direct messages. One sign-in per workspace.',
    connectLabel: 'Connect Slack workspace',
    anotherLabel: 'Connect another workspace',
    pending: 'The Geld Slack app is not available in this build yet.',
  },
];
