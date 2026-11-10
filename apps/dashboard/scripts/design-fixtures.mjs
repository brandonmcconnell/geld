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
  seats: 3,
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
        'Match saved decisions to the exact code being reviewed. A step keeps its decision only when its fingerprint still matches.',
      why: 'A new push should ask for another look only where the code changed.',
      touches: [{ path: 'src/review/progress.ts', hunk: 0 }],
      supporting: [{ path: 'src/review/progress.test.ts', hunk: 0 }],
      dependsOn: [],
      watch: ['A changed fingerprint must reset the previous decision.'],
      findings: [],
      fingerprint: 'design-fingerprint',
    },
    {
      id: 'account-storage',
      title: 'Keep saved progress inside the account',
      kind: 'fix',
      story:
        'Include the account and pull request in the storage key, then validate saved progress before restoring it.',
      why: 'Switching accounts must never restore another reviewer’s decisions.',
      touches: [{ path: 'src/review/storage.ts', hunk: 0 }],
      supporting: [{ path: 'src/review/storage.test.ts', hunk: 0 }],
      dependsOn: ['preserve'],
      watch: ['Malformed saved data should return an empty state.'],
      findings: [],
      fingerprint: 'storage-fingerprint',
    },
    {
      id: 'fingerprint',
      title: 'Compare the changed code',
      kind: 'refactor',
      story:
        'Derive fingerprints from the changed hunks rather than the step title. Renaming a guide step should not invalidate a decision.',
      why: null,
      touches: [{ path: 'src/review/fingerprint.ts', hunk: 0 }],
      supporting: [{ path: 'src/review/fingerprint.test.ts', hunk: 0 }],
      dependsOn: [],
      watch: [],
      findings: [],
      fingerprint: 'content-fingerprint',
    },
  ],
};
async function configure(context, state = {}) {
  let acceptedInvite = false;
  const writes = [];
  let providerRows = [
    {
      id: 'geld-provider',
      provider: 'geld',
      label: 'Geld',
      base_url: null,
      enabled: true,
      has_key: false,
      settings: { billed: !!state.geldEnabled, safetyNet: !!state.fallbackEnabled, capCents: 5000, teamId },
    },
    ...(state.emptyProviders || state.emptyModels ? [] : structuredClone(providers)),
  ];
  const stressFiles = Array.from({ length: 50 }, (_, index) => {
    const template = fixture.review.files.find((file) => !file.hidden);
    return {
      ...template,
      path: 'src/modules/module-' + String(index + 1).padStart(2, '0') + '.ts',
      hidden: false,
      category: null,
      additions: template.additions * 4,
      deletions: template.deletions * 4,
      hunks: Array.from({ length: 4 }, (_, hunk) => ({
        ...template.hunks[0],
        header: '@@ -' + (hunk * 20 + 1) + ',4 +' + (hunk * 20 + 1) + ',7 @@',
        oldStart: hunk * 20 + 1,
        newStart: hunk * 20 + 1,
        lines: template.hunks[0].lines.map((line) => ({
          ...line,
          oldLine: line.oldLine === null ? null : line.oldLine + hunk * 20,
          newLine: line.newLine === null ? null : line.newLine + hunk * 20,
        })),
      })),
    };
  });
  const activeReview = state.largeGuide
    ? { ...fixture.review, files: stressFiles }
    : state.staleBot || state.untrustedDigest
      ? {
          ...fixture.review,
          comments: fixture.review.comments.map((comment) =>
            comment.id === 'geld-summary'
              ? {
                  ...comment,
                  author: state.untrustedDigest ? 'untrusted-author' : comment.author,
                  body: state.staleBot
                    ? comment.body.replaceAll(
                        '"reviewedSha":"' + fixture.review.pull.headSha + '"',
                        '"reviewedSha":"' + 'b'.repeat(40) + '"',
                      )
                    : comment.body,
                }
              : comment,
          ),
        }
      : fixture.review;
  const activePlan = state.largeGuide
    ? {
        ...plan,
        steps: Array.from({ length: 200 }, (_, index) => ({
          ...plan.steps[index % plan.steps.length],
          id: 'stress-' + index,
          title: index + 1 + '. ' + plan.steps[index % plan.steps.length].title,
          dependsOn: [],
          touches: [{ path: stressFiles[Math.floor(index / 4)].path, hunk: index % 4 }],
          supporting: [],
        })),
      }
    : plan;
  await context.addInitScript(
    ({ user, plan, guided, gpc }) => {
      if (gpc) Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
      if (guided && !localStorage.getItem(`geld.review.v2:${user.id}:/github/acme/platform/pull/128`))
        localStorage.setItem(
          `geld.review.v2:${user.id}:/github/acme/platform/pull/128`,
          JSON.stringify({ plan, progress: {} }),
        );
    },
    { user, plan: activePlan, guided: !!state.guided, gpc: !!state.gpc },
  );
  await context.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname,
      post = request.method() !== 'GET';
    if (post) writes.push({ path: p, body: request.postData() });
    if (p === `/api/teams/${teamId}` && post && request.postDataJSON()?.action === 'accept_invite')
      acceptedInvite = true;
    let data = {},
      status = 200;
    if (p === '/api/session')
      data = {
        configured: state.configured !== false,
        demo: false,
        user: state.signedOut ? null : user,
        viewers: { github: 'alex' },
      };
    else if (p === '/api/measurement/config')
      data = {
        config: state.measurement ? { key: 'phc_synthetic_fixture', host: 'https://metrics.example.test' } : null,
      };
    else if (p === '/api/measurement/sdk')
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.__geldMeasurement={events:[],optedOut:0};window.posthog={init(){},opt_in_capturing(){},capture(event,properties){window.__geldMeasurement.events.push({event,properties})},opt_out_capturing(){window.__geldMeasurement.optedOut++},reset(){}};',
      });
    else if (p === '/api/queue/insight') {
      const pull = fixture.queue.pulls.find((pull) => pull.ref.number === Number(url.searchParams.get('number')));
      const count = (files) => ({
        files: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      });
      const hidden = fixture.review.files.filter((file) => file.hidden);
      const main = pull?.ref.provider === 'github' && pull.ref.number === 128;
      const hiddenAdded = Math.floor((pull?.additions ?? 0) * 0.6);
      const hiddenRemoved = Math.floor((pull?.deletions ?? 0) * 0.5);
      const extraHiddenFiles = pull?.draft ? 1 : 2;
      data = {
        headSha: pull?.headSha ?? fixture.review.pull.headSha,
        digest:
          state.queueDigestMissing || pull?.ref.provider !== 'github'
            ? null
            : state.queueDigestStale
              ? { state: 'stale' }
              : {
                  state: 'current',
                  open: pull.ref.number === 127 ? 0 : 2,
                  needsReply: pull.ref.number === 128 ? 1 : 0,
                  approvals: pull.ref.number === 124 ? 0 : 1,
                  changesRequested: pull.ref.number === 124 ? 1 : 0,
                  partial: !!state.queueDigestPartial,
                  bots:
                    pull.ref.number === 124
                      ? [{ id: 'greptile', name: 'Greptile', verdict: 'earlier' }]
                      : [
                          { id: 'greptile', name: 'Greptile', verdict: 'clean', score: 5 },
                          {
                            id: 'coderabbit',
                            name: 'CodeRabbit',
                            verdict: pull.ref.number === 127 ? 'clean' : 'findings',
                          },
                        ],
                },
        essential: main
          ? count(fixture.review.files.filter((file) => !file.hidden))
          : {
              files: pull?.draft ? 2 : 4,
              additions: (pull?.additions ?? 0) - hiddenAdded,
              deletions: (pull?.deletions ?? 0) - hiddenRemoved,
            },
        hidden: main ? count(hidden) : { files: extraHiddenFiles, additions: hiddenAdded, deletions: hiddenRemoved },
        categories: main
          ? [...new Set(hidden.map((file) => file.category))].map((label) => ({
              id: label.toLowerCase(),
              label,
              ...count(hidden.filter((file) => file.category === label)),
            }))
          : [
              {
                id: 'tests',
                label: 'Tests',
                files: extraHiddenFiles,
                additions: hiddenAdded,
                deletions: hiddenRemoved,
              },
            ],
        requesters: pull?.ref.provider === 'github' ? (pull.ref.number === 128 ? ['alex'] : ['morgan']) : null,
      };
    } else if (p === '/api/queue') {
      if (state.queueLoading) return;
      data = state.queueError
        ? { error: 'The provider could not connect.' }
        : state.emptyQueue
          ? { pulls: [], repositories: [], sources: [] }
          : fixture.queue;
      status = state.queueError ? 503 : 200;
    } else if (p === '/api/teams') data = { teams: state.emptyTeams ? [] : [team] };
    else if (p === '/api/pull') {
      data = activeReview;
      if (state.pullError) {
        data = { error: 'Reconnect this provider to continue reviewing.' };
        status = 503;
      }
    } else if (p === '/api/guides') data = { plan: state.guided ? activePlan : null };
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
    else if (p === '/api/notifications') {
      if (state.inboxError) {
        await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        return;
      }
      data = {
        invites: acceptedInvite || state.emptyInbox ? [] : [{ team_id: teamId, name: 'Platform engineering' }],
        notifications: state.emptyInbox
          ? []
          : [
              { id: 'notification-1', team_id: teamId, kind: 'review_requested' },
              { id: 'notification-2', team_id: teamId, kind: 'repository_connected' },
            ],
      };
    } else if (p === '/api/ai/providers') {
      if (post && state.providerSaveError) {
        status = 503;
        data = { error: 'Provider settings could not be saved.' };
      } else if (request.method() === 'DELETE') {
        providerRows = providerRows.filter((row) => row.id !== request.postDataJSON().id);
        data = { removed: true };
      } else if (post) {
        const input = request.postDataJSON();
        const id = input.id ?? 'new-provider';
        const existing = providerRows.find((row) => row.id === id);
        const saved = {
          id,
          provider: input.provider,
          label: input.label,
          base_url: input.baseUrl ?? null,
          has_key: !!input.key || !!existing?.has_key,
          enabled: input.enabled,
          settings: { ...input },
        };
        providerRows = existing ? providerRows.map((row) => (row.id === id ? saved : row)) : [...providerRows, saved];
        data = { id };
      } else data = { configured: true, providers: providerRows };
    } else if (p === '/api/ai/models')
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
    else if (p === '/api/billing')
      data = { teams: [{ ...team, card_on_file: !state.fallbackUnavailable }], configured: true, testMode: true };
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
        repositories: [{ id: 'demo-1', owner: 'acme', name: 'platform', settings: {} }],
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
            repoId: 'demo-1',
            repository: 'acme/platform',
            provider: 'github',
            host: 'github.com',
          },
        ],
        repositories: [{ id: 'demo-1', name: 'platform', owner: 'acme', provider: 'github', host: 'github.com' }],
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
              team: {
                ...team,
                role: state.member ? 'member' : 'admin',
                managed_access: true,
                sync_enabled: false,
                add_approval: true,
                visibility: 'names',
              },
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
              requests: [{ id: 'request-1', repo_id: 'demo-1', kind: 'join', state: 'pending', canDecide: true }],
              grants: [
                {
                  id: 'grant-1',
                  user_id: 'member-2',
                  repo_id: 'demo-1',
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
    else if (p === '/api/assignments') data = { repoId: 'demo-1', members: [], requested: [] };
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
