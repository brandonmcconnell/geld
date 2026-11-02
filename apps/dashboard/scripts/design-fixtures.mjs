import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../docs/dashboard/design/fixtures.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const teamId = '00000000-0000-4000-8000-000000000001';
const user = { id: 'design-reviewer', name: 'Jordan Rivera', email: 'jordan@example.test' };
const team = {
  id: teamId,
  name: 'Platform engineering',
  role: 'admin',
  tier: 'business',
  seats: 8,
  used_credits: 124,
  cap_cents: 5000,
  spent_cents: 850,
  card_on_file: true,
};
const providers = [
  {
    id: 'provider-1',
    provider: 'gateway',
    label: 'Team gateway',
    base_url: 'https://ai-gateway.vercel.sh',
    enabled: true,
    has_key: true,
    settings: { models: ['anthropic/claude-sonnet-4.6'], automaticLadder: true, mode: 'api' },
  },
  {
    id: 'provider-2',
    provider: 'claude',
    label: 'Local Claude',
    base_url: null,
    enabled: true,
    has_key: false,
    settings: { mode: 'login', automaticLadder: true },
  },
];
const policy = { trigger: 'click', drafts: false, override: true, locked: false };
const members = [
  { id: user.id, name: user.name, role: 'admin' },
  { id: 'member-2', name: 'Morgan Chen', role: 'member' },
  { id: 'member-3', name: 'Sam Ellis', role: 'member' },
];
const plan = {
  id: 'design-plan',
  headSha: fixture.review.pull.headSha,
  madeAt: '2026-11-02T00:00:00Z',
  producer: 'ai',
  model: 'Illustrative guide',
  excerpted: false,
  unassigned: [],
  steps: [
    {
      id: 'preserve',
      title: 'Preserve completed review steps',
      kind: 'fix',
      story:
        'Previously, updating a pull request reset every step to pending. This change compares each step’s fingerprint and keeps the reviewer’s decision when the underlying code has not changed.',
      why: 'Reviewers can spend their time on new changes instead of repeating work they already completed.',
      touches: fixture.review.files.filter((f) => !f.hidden).map((f) => ({ path: f.path, hunk: 0 })),
      supporting: fixture.review.files.filter((f) => f.hidden).map((f) => ({ path: f.path, hunk: 0 })),
      dependsOn: [],
      watch: [
        'A changed fingerprint must always reset the previous decision.',
        'New steps must start in the pending state.',
      ],
      findings: [],
      fingerprint: 'design-fingerprint',
    },
  ],
};
async function configure(context, state = {}) {
  const writes = [];
  await context.addInitScript(
    ({ user, plan, guided }) => {
      if (guided && !localStorage.getItem(`geld.review.v2:${user.id}:/github/acme/platform/pull/128`))
        localStorage.setItem(
          `geld.review.v2:${user.id}:/github/acme/platform/pull/128`,
          JSON.stringify({ plan, progress: {} }),
        );
    },
    { user, plan, guided: !!state.guided },
  );
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname,
      post = request.method() !== 'GET';
    if (post) writes.push({ path: p, body: request.postData() });
    let data = {},
      status = 200;
    if (p === '/api/session')
      data = {
        configured: state.configured !== false,
        demo: false,
        user: state.signedOut ? null : user,
        viewers: { github: 'alex' },
      };
    else if (p === '/api/queue') {
      if (state.queueLoading) await new Promise((resolve) => setTimeout(resolve, 3000));
      data = state.queueError
        ? { error: 'The provider could not connect.' }
        : state.emptyQueue
          ? { pulls: [], repositories: [], sources: [] }
          : fixture.queue;
      status = state.queueError ? 503 : 200;
    } else if (p === '/api/teams') data = { teams: state.emptyTeams ? [] : [team] };
    else if (p === '/api/pull') {
      data = fixture.review;
      if (state.pullError) {
        data = { error: 'Reconnect this provider to continue reviewing.' };
        status = 503;
      }
    } else if (p === '/api/guides') data = { plan: state.guided ? plan : null };
    else if (p === '/api/auth/list-accounts')
      data = state.onboarding
        ? []
        : [
            { id: 'identity-1', providerId: 'github', accountId: 'jordan' },
            { id: 'identity-2', providerId: 'gitlab', accountId: 'jordan' },
          ];
    else if (p === '/api/repositories/selection') data = { choices: [] };
    else if (p === '/api/account/connections')
      data = { connections: [{ id: 'connection-1', host: 'github.com', slug: 'geld-repositories' }] };
    else if (p === '/api/notifications')
      data = {
        invites: [{ team_id: teamId, name: 'Platform engineering' }],
        notifications: [
          { id: 'notification-1', team_id: teamId, kind: 'review_requested' },
          { id: 'notification-2', team_id: teamId, kind: 'repository_connected' },
        ],
      };
    else if (p === '/api/ai/providers')
      data = post ? { id: 'new-provider' } : { configured: true, providers: state.emptyModels ? [] : providers };
    else if (p === '/api/ai/models')
      data = {
        models: state.emptyModels
          ? []
          : [
              {
                id: 'anthropic/claude-sonnet-4.6',
                name: 'Claude Sonnet 4.6',
                provider: 'gateway',
                instance: 'provider-1',
              },
              { id: 'openai/gpt-5.4', name: 'GPT-5.4', provider: 'gateway', instance: 'provider-1' },
              { id: 'google/gemini-3.1-pro', name: 'Gemini 3.1 Pro', provider: 'gateway', instance: 'provider-1' },
            ],
        someUnavailable: !!state.partialModels,
      };
    else if (p === '/api/billing') data = { teams: [team], configured: true, testMode: true };
    else if (p === '/api/security')
      data = {
        events: [
          { id: 'audit-1', action: 'provider.connected', outcome: 'success', created_at: '2026-11-02T00:00:00Z' },
          { id: 'audit-2', action: 'review.submitted', outcome: 'success', created_at: '2026-11-01T23:30:00Z' },
          { id: 'audit-3', action: 'team.invited', outcome: 'success', created_at: '2026-11-01T22:15:00Z' },
        ],
      };
    else if (p === '/api/enterprise')
      data = {
        hosts: [
          { host: 'git.acme.example', team_id: teamId, relay_channel: 'synthetic-channel', direct_allowed: false },
        ],
      };
    else if (p === `/api/teams/${teamId}/review-defaults`)
      data = {
        team: { guide_policy: policy },
        repositories: [{ id: 'repo-1', owner: 'acme', name: 'platform', settings: {} }],
        members,
      };
    else if (p === `/api/teams/${teamId}/sso`)
      data = {
        providers: [
          {
            providerId: 'sso-1',
            domain: 'acme.example',
            domainVerified: true,
            issuer: 'https://identity.acme.example',
            canManage: true,
          },
        ],
      };
    else if (p === `/api/teams/${teamId}/collaborators`)
      data = {
        collaborators: [
          {
            id: 'outside-1',
            login: 'avery',
            permission: 'write',
            repoId: 'repo-1',
            repository: 'acme/platform',
            provider: 'github',
            host: 'github.com',
          },
        ],
        repositories: [{ id: 'repo-1', name: 'platform', owner: 'acme', provider: 'github', host: 'github.com' }],
        unavailable: [],
        next: null,
      };
    else if (p === `/api/teams/${teamId}`)
      data =
        url.searchParams.get('preview') === 'destroy'
          ? {
              deleting: false,
              grants: [{ id: 'g1' }],
              groups: [],
              personal: [{ grantId: 'g2', repository: 'acme/platform', login: 'jordan', ownership: 'person' }],
              unavailable: [],
              confirmation: 'synthetic-confirmation',
            }
          : {
              team: { ...team, managed_access: true, sync_enabled: false, add_approval: true, visibility: 'names' },
              repositories: fixture.queue.repositories.map((r) => ({
                id: r.id,
                name: r.ref.repo,
                owner: r.ref.owner,
                provider: r.ref.provider,
                url: r.url,
                accessible: true,
              })),
              hiddenCount: 0,
              members,
              requests: [{ id: 'request-1', repo_id: 'repo-1', kind: 'join', state: 'pending', canDecide: true }],
              grants: [
                {
                  id: 'grant-1',
                  user_id: 'member-2',
                  repo_id: 'repo-1',
                  mechanism: 'app',
                  source: 'geld',
                  state: 'active',
                },
              ],
              jobs: [],
            };
    else if (p === '/api/apps')
      data = {
        installations: [{ id: 'installation-1', account_slug: 'acme', slug: 'geld-repositories', state: 'active' }],
      };
    else if (p === '/api/tracker') data = { config: { provider: 'linear', keys: ['ENG', 'APP'] } };
    else if (p === '/api/assignments') data = { repoId: 'repo-1', members: [], requested: [] };
    else if (p === '/api/assistant')
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/plain', 'X-Geld-Model': 'Illustrative response' },
        body: 'The change preserves a review decision only when the saved and current fingerprints match. If any reviewed hunk changes, that step returns to pending. Check the unchanged and changed fingerprint cases in the supporting tests.',
      });
    else if (p.startsWith('/api/auth/')) {
      if (
        (state.authError && p.includes('/sign-in/email-otp')) ||
        (state.resetError && p.endsWith('/reset-password'))
      ) {
        data = { code: 'INVALID_OTP', message: 'Invalid code' };
        status = 400;
      } else data = { status: true, success: true, user, token: 'synthetic-browser-fixture' };
    }
    await route.fulfill({ status, json: data });
  });
  return writes;
}
export { configure, fixture, teamId, user, plan };
