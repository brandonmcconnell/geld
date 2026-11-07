import { describe, expect, it } from 'vitest';
import { isDependencyUpdate, relatedLinkOf, relatedLinksFrom, slugTitle } from './related-links';

const read = (href: string, text = href) => relatedLinkOf({ href, text });

describe('relatedLinkOf', () => {
  it("reads Replicas' footer: the workspace, the Slack thread it was asked in and its Linear badge", () => {
    expect(read('https://app.replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010', 'Replicas Workspace')).toMatchObject({
      key: 'replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010',
      kind: 'agent',
      service: 'Replicas',
      noun: 'workspace',
      ref: null,
      title: null,
      action: 'View workspace in Replicas',
      appId: 2176876,
    });
    expect(read('https://replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010')?.key).toBe('replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010');
    expect(read('https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&cid=C0BCMJ9JFA9', 'Slack Thread')).toMatchObject({
      key: 'slack:mintlify:C0BCMJ9JFA9:1793123214.352139',
      kind: 'conversation',
      noun: 'thread',
      ref: null,
      title: null,
      context: 'mintlify',
      action: 'Open thread in Slack',
    });
    expect(read('https://linear.app/rpd-34/issue/LIM-1391/featstreaming-add-buffered-streamingencoder-wrapper-and-flush-policy', 'Linear LIM-1391')).toMatchObject({
      key: 'linear:rpd-34:LIM-1391',
      kind: 'ticket',
      noun: 'issue',
      ref: 'LIM-1391',
      action: 'Open issue in Linear',
      title: 'Featstreaming add buffered streamingencoder wrapper and flush policy',
      context: 'rpd-34',
      icon: 'linear',
    });
  });

  it('takes the title in the URL over the link’s words, and the words only when they say more than the service and label', () => {
    expect(read('https://linear.app/acme/issue/ENG-12', 'ENG-12 Fix the SDK nav')?.title).toBe('Fix the SDK nav');
    expect(read('https://linear.app/acme/issue/ENG-12/fix-the-sdk-nav', 'the nav thing')?.title).toBe('Fix the sdk nav');
    expect(read('https://linear.app/acme/issue/ENG-12/fix-the-sdk-nav', 'ENG-12')?.title).toBe('Fix the sdk nav');
    expect(read('https://linear.app/wulfgardr/issue/WUL-766', 'WUL-766')?.title).toBeNull();
    expect(read('https://linear.app/acme/issue/ENG-12', 'https://linear.app/acme/issue/ENG-12')?.title).toBeNull();
    expect(read('https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88', 'Open in Web')?.title).toBeNull();
    expect(read('https://app.coderabbit.ai/change-stack/acme/web/pull/3?scope=x', 'Explain Change →')?.title).toBeNull();
    expect(read('https://welibrary.atlassian.net/browse/LC-2379', 'Check Jira issue')?.title).toBeNull();
  });

  it('tells a Slack thread, a message, a direct message and a channel apart', () => {
    expect(read('https://replicas-group.slack.com/archives/C0C4EG8J4D7/p1793254029666000', 'Slack Thread')?.noun).toBe('thread');
    expect(read('https://replicas-group.slack.com/archives/C0C4EG8J4D7/p1793254029666000', 'see here')?.noun).toBe('message');
    expect(read('https://superserve-ai.slack.com/archives/D0C8P610CTC/p1793256576237969?thread_ts=1793256576.237969&cid=D0C8P610CTC')?.context).toBe('superserve-ai · direct message');
    expect(read('https://acme.slack.com/archives/C0123ABCD')).toMatchObject({ noun: 'channel', context: 'acme' });
    expect(read('https://app.slack.com/client/T06T9CEDK4G/C0123UCREZKP/thread/C0123UCREZKP-1793123214.352139')?.noun).toBe('thread');
    expect(read('https://hooks.slack.com/archives/C0123ABCD')).toBeNull();
    expect(read('https://acme.slack.com/apps/A123')).toBeNull();
  });

  it('reads the agent sessions surveyed in pull request bodies, and nothing else on their sites', () => {
    const cases: readonly [string, string, string][] = [
      ['https://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac', 'Devin', 'session'],
      ['https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88?cursor_ref=pr_footer&cursor_cta=open_in_web', 'Cursor', 'agent'],
      ['https://cursor.com/automations/1e8b0ec6-3214-47ed-ad52-fe5e53731673', 'Cursor', 'automation'],
      ['https://chatgpt.com/codex/tasks/task_e_6ae8d5cf0b888326a400a7a595f21f92', 'Codex', 'task'],
      ['https://claude.ai/code/session_012iWoghkDcUN9hKsHfTMmRN', 'Claude Code', 'session'],
      ['https://jules.google.com/session/14802421810633168803', 'Jules', 'session'],
      ['https://jules.google.com/task/2477554349391176182', 'Jules', 'task'],
      ['https://github.com/copilot/tasks/pull/PR_kwDOPpiWZs7TOc61?session_id=8e9caed1-a814-4e98-9ebb-e1ff5b3cac4f', 'Copilot', 'session'],
      ['https://ampcode.com/threads/T-019a2f47-6cf1-7339-a0d2-9b8a1b7c6d5e', 'Amp', 'thread'],
      ['https://app.all-hands.dev/conversations/0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'OpenHands', 'conversation'],
      ['https://codegen.com/agent/trace/123456', 'Codegen', 'run'],
      ['https://app.tembo.io/sessions/4769ebff-6bdf-4cec-a73b-e4b457ab1d5c', 'Tembo', 'session'],
      ['https://www.terragonlabs.com/task/4769ebff-6bdf-4cec-a73b-e4b457ab1d5c', 'Terragon', 'task'],
      ['https://app.warp.dev/conversation/3302b26f-8b16-4ae5-af91-393927361e54', 'Warp', 'conversation'],
      ['https://oz.warp.dev/runs/019fa605-7f56-79a1-95ed-b98472fc762d', 'Oz', 'run'],
      ['https://cosine.sh/cosine/poke-the-bear/task/kpbh4va6yap7', 'Cosine', 'task'],
      ['https://opencode.ai/s/fcnBJ5sx', 'opencode', 'session'],
      ['https://lovable.dev/projects/4769ebff-6bdf-4cec-a73b-e4b457ab1d5c', 'Lovable', 'project'],
      ['https://app.factory.ai/automations?editAutomationId=4769ebff-6bdf-4cec-a73b-e4b457ab1d5c', 'Factory', 'automation'],
    ];
    for (const [href, service, noun] of cases) expect(read(href), href).toMatchObject({ kind: 'agent', service, noun, ref: null });
    for (const href of [
      'https://cursor.com/dashboard/cloud-agents#my-pull-requests',
      'https://cursor.com/assets/images/open-in-web-dark.png',
      'https://chatgpt.com/codex/tasks',
      'https://claude.ai/code',
      'https://claude.com/claude-code',
      'https://app.factory.ai/sessions/new?prompt=Continue',
      'https://app.factory.ai/settings/api-keys',
      'https://codegen.com/agent/trace/123456/ban',
      'https://app.tembo.io/settings/models',
      'https://app.devin.ai/settings',
      'http://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac',
      'https://app.devin.ai.evil.example/sessions/d71d660849c3422eadd668dd12739bac',
    ]) expect(read(href), href).toBeNull();
  });

  it('reads the review tools that link to their view of the pull request', () => {
    expect(read('https://app.devin.ai/review/terraware/terraware-web/pull/7078', 'View findings')).toMatchObject({ kind: 'review', service: 'Devin Review', key: 'devin-review:terraware/terraware-web#7078' });
    expect(read('https://app.greptile.com/review/github/acme/web/pull/9')?.key).toBe('greptile:review/github/acme/web/pull/9');
    expect(read('https://app.greptile.com/-/switch-tenant?tenant=o&next=%2Freview%2Fgithub%2Facme%2Fweb%2Fpull%2F9')?.key).toBe('greptile:review/github/acme/web/pull/9');
    expect(read('https://app.greptile.com/api/retrigger?pull=9')).toBeNull();
    expect(read('https://app.graphite.dev/github/pr/Metta-AI/metta/1234')).toMatchObject({ kind: 'review', service: 'Graphite' });
    expect(read('https://app.graphite.dev/background-agents/TakshPSingh/public-test-repo/task/bgt_01abc')).toMatchObject({ kind: 'agent', service: 'Graphite' });
  });

  it('reads tickets, docs and errors by their exact shapes', () => {
    expect(read('https://bro73.atlassian.net/browse/SCRUM-59')).toMatchObject({ key: 'jira:bro73:SCRUM-59', noun: 'issue', ref: 'SCRUM-59', context: 'bro73', action: 'Open issue in Jira' });
    expect(read('https://acme.atlassian.net/jira/software/projects/ENG/boards/3?selectedIssue=ENG-42')).toMatchObject({ key: 'jira:acme:ENG-42' });
    expect(read('https://acme.atlassian.net/jira/software/projects/ENG/boards/3')).toBeNull();
    expect(read('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist')).toMatchObject({ service: 'Confluence', title: 'Release checklist' });
    expect(read('https://app.shortcut.com/acme/story/123/fix-login')).toMatchObject({ noun: 'story', ref: 'sc-123', title: 'Fix login' });
    expect(read('https://www.notion.so/citizenlab/Changelog-How-it-works-0123456789abcdef0123456789abcdef')).toMatchObject({ service: 'Notion', title: 'Changelog How it works' });
    expect(read('https://www.notion.so/my-integrations')).toBeNull();
    expect(read('https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Geld-Design?node-id=1-2')).toMatchObject({ noun: 'file', title: 'Geld Design' });
    expect(read('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit')).toMatchObject({ noun: 'doc' });
    expect(read('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toMatchObject({ noun: 'video' });
    expect(read('https://tita-30.sentry.io/issues/GEOG-2A')).toMatchObject({ kind: 'error', noun: 'issue', ref: 'GEOG-2A', context: 'tita-30' });
    expect(read('https://sentry.io/organizations/warpdotdev/issues/123456/')).toMatchObject({ noun: 'issue', ref: null, context: 'warpdotdev' });
    expect(read('https://linear.app/developers/graphql')).toBeNull();
    expect(read('https://linear.app/acme/project/geld-related-links-0123456789ab/overview')).toMatchObject({ noun: 'project', ref: null, title: 'Geld related links', action: 'Open project in Linear' });
  });
  it('reads the shapes a run over 8,820 public pull request bodies found in use (Nov 2026)', () => {
    const cases: readonly [string, Partial<Record<'service' | 'noun' | 'ref' | 'title' | 'context' | 'kind', string | null>>][] = [
      ['https://linear.app/boat-ai/issue/BOA-1029/%E7%9B%B4%E5%89%8D%E6%83%85%E5%A0%B1', { service: 'Linear', ref: 'BOA-1029', title: '直前情報' }],
      ['https://linear.app/niritberg/document/%D7%90%D7%A4%D7%99%D7%95%D7%9F-mvp-013ae4192d48', { noun: 'document', title: 'אפיון mvp' }],
      ['https://linear.app/relevance/issue/b9046624-7308-4774-9da7-b9db37e19a1c/', { noun: 'issue', ref: null }],
      ['https://trello.com/c/l8lvc96F/2748-tags-de-r%C3%A9sultats', { noun: 'card', title: 'Tags de résultats' }],
      ['https://trello.com/c/6aeb91025f3cbe18ed7c6141', { noun: 'card' }],
      ['https://cursor.com/agents?id=bc-e5627833-b458-4658-99cb-f1b6ffe67347', { service: 'Cursor', noun: 'agent' }],
      ['https://claude.ai/code/project/chan_017WNUkNK8kdDziPK58Pv6G9?thread=cmsg_017WNUkNK8kdDziPK58Pv6G95c3ry3k', { service: 'Claude Code', noun: 'thread' }],
      ['https://chatgpt.com/codex/cloud/tasks/task_e_6a58fe708cfc832fbcfbbf085d2d1790', { service: 'Codex', noun: 'task' }],
      ['https://app.tembo.io/tasks/c93ae4bd-04c0-4777-863f-7e41bbb787c2', { service: 'Tembo', noun: 'task' }],
      ['https://app.warp.dev/session/a9c1bede-c7e2-4c65-8c04-ca485f120714', { service: 'Warp', noun: 'session' }],
      ['https://staging.warp.dev/conversation/a13bffda-ca83-4695-929f-c2b4fa9b4210', { service: 'Warp', noun: 'conversation' }],
      ['https://oz.staging.warp.dev/runs/019de10c-2768-7b10-8e16-6d409156a9c8', { service: 'Oz', noun: 'run' }],
      ['https://cosine.sh/gh/zakker111/Roguelike_whit_world/pull/139', { service: 'Cosine', kind: 'review', noun: 'pull request' }],
      ['https://nvidia.devinenterprise.com/review/ai-dynamo/dynamo/pull/10004', { service: 'Devin Review', noun: 'findings' }],
      ['https://app.graphite.com/github/pr/KingInYellows/yellow-plugins/1706', { service: 'Graphite', noun: 'pull request' }],
      ['https://app.asana.com/1/137249556945/task/1218095597330026/comment/1219956877357222?focus=true', { service: 'Asana', noun: 'task' }],
      ['https://app.asana.com/1/29923630752984/home/task/1215936908693667', { service: 'Asana', noun: 'task' }],
      ['https://discord.com/channels/1300358874280230994/1503706103752429618/threads/1566848506369548388', { service: 'Discord', noun: 'thread' }],
      ['https://etu-apu-9371.youtrack.cloud/issues?q=%7B35%7D&preview=SF-35', { service: 'YouTrack', ref: 'SF-35', context: 'etu-apu-9371' }],
      ['https://diploma-aitu-2027.youtrack.cloud/agiles/204-1/current?issue=MAS-9', { service: 'YouTrack', ref: 'MAS-9' }],
      ['https://youtrack.jetbrains.com/issue/IDEA-123456/Freeze-on-startup', { service: 'YouTrack', ref: 'IDEA-123456', title: 'Freeze on startup', context: 'youtrack.jetbrains.com' }],
      ['https://sector12.youtrack.cloud/articles/EWS-A-25', { service: 'YouTrack', kind: 'doc', noun: 'article', ref: 'EWS-A-25' }],
      ['https://sentry.io/travis-ci/org-listener-production/issues/587467865/', { service: 'Sentry', context: 'travis-ci' }],
      ['https://sentry.io/organizations/a8c/issues/2455740809/tags/?project=1438088', { service: 'Sentry', context: 'a8c' }],
      ['https://base-254.sentry.io/issues/7750428823/events/?project=4512094504026112', { service: 'Sentry', context: 'base-254' }],
      ['https://tier4.atlassian.net/wiki/x/GwAFQwE', { service: 'Confluence', noun: 'page', context: 'tier4' }],
      ['https://app.shortcut.com/trefry/epic/27962', { service: 'Shortcut', noun: 'epic', ref: null }],
      ['https://app.clickup.com/9017787639/docs/8cr117q-3237', { service: 'ClickUp', kind: 'doc' }],
      ['https://height.app/gkSnvZYAS2/T-140', { service: 'Height', ref: 'T-140' }],
      ['https://app.plane.so/peppy/browse/FRAMEWORK-235/', { service: 'Plane', ref: 'FRAMEWORK-235', context: 'peppy' }],
      ['https://app.notion.com/p/sentry/Investigation-Events-Workflow-Engine-40c8b10e4b5d80d18c4ed6c802d55d64?d=40e8b10e4b5d8042babd001c261d278c', { service: 'Notion', title: 'Investigation Events Workflow Engine' }],
      ['https://jira.atlassian.com/browse/JRASERVER-73305', { service: 'Jira', ref: 'JRASERVER-73305', context: 'jira.atlassian.com' }],
      ['https://issues.apache.org/jira/browse/KAFKA-17000', { service: 'Jira', ref: 'KAFKA-17000', context: 'issues.apache.org' }],
      ['https://gitlab.com/cznic/sqlite/-/issues/263', { service: 'GitLab', noun: 'issue', ref: '#263', context: 'cznic/sqlite' }],
      ['https://gitlab.com/cznic/sqlite/-/merge_requests/142', { service: 'GitLab', noun: 'merge request', ref: '!142' }],
      ['https://gitlab.com/cznic/sqlite/-/work_items/263', { service: 'GitLab', noun: 'work item', ref: '#263' }],
      ['https://gitlab.com/groups/gitlab-org/-/epics/123', { service: 'GitLab', noun: 'epic', ref: '&123', context: 'gitlab-org' }],
      ['https://gitlab.studiometa.dev/team/app/-/issues/12', { service: 'GitLab', context: 'gitlab.studiometa.dev/team/app' }],
      ['https://bitbucket.org/connect2id/nimbus-jose-jwt/issues/619', { service: 'Bitbucket', noun: 'issue', ref: '#619', context: 'connect2id/nimbus-jose-jwt' }],
      ['https://bitbucket.org/acme/web/pull-requests/42/fix-login', { service: 'Bitbucket', noun: 'pull request', ref: '#42' }],
    ];
    for (const [href, expected] of cases) expect(read(href), href).toMatchObject(expected);
    for (const href of [
      'https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88/artifacts?path=%2Fopt%2Fcursor%2Fartifacts%2Fa.png',
      'https://app.greptile.com/api/retrigger?id=96257428',
      'https://dhis2.atlassian.net/browse/ANDROAPP-<ISSUE-NUMBER>',
      'https://app.tembo.io/agents/094a3a18-e371-4285-b2a1-53d7bd8fb9c4',
      'https://www.cubic.dev/action/auto-fix/pr/n8n-io/n8n/42872',
      'https://gitlab.com/cznic/sqlite/commit/4df1ebea0f1cf0cd6ec3245b26f5fec4234ce738',
      'https://gitlab.com/cznic/sqlite/blob/master/CHANGELOG.md',
      'https://github.com/acme/web/-/issues/1',
      'https://bitbucket.org/b_c/jose4j/commits/756257eb92352600d5dde08c2b8ed25db13a8952',
      'https://www.loom.com/share/VIDEO_ID',
      'https://app.devin.ai/api/presigned_proxy?token=x',
    ]) expect(read(href), href).toBeNull();
  });
});

describe('GitHub references', () => {
  const options = { githubHosts: ['github.com', 'git.acme.dev'], repository: 'acme/web', self: 'acme/web#7' };
  const readHere = (href: string, text = href) => relatedLinkOf({ href, text }, options);

  it('reads issues, pull requests and discussions: `#N` in this repository, `repo#N` in its owner’s, `owner/repo#N` elsewhere', () => {
    expect(readHere('https://github.com/acme/web/issues/12', '#12')).toMatchObject({ kind: 'github', service: 'GitHub', noun: 'issue', ref: '#12', title: null, context: 'acme/web', action: 'Open issue on GitHub' });
    expect(readHere('https://github.com/acme/api/pull/5', 'acme/api#5')).toMatchObject({ ref: 'api#5', title: null });
    expect(readHere('https://github.com/vercel/next.js/pull/52514', 'vercel/next.js#52514')).toMatchObject({ noun: 'pull request', ref: 'vercel/next.js#52514', title: null });
    expect(readHere('https://github.com/acme/web/pull/3/files', 'the refactor')).toMatchObject({ ref: '#3', title: 'the refactor' });
    expect(readHere('https://github.com/acme/web/issues/12#issuecomment-1', '#12 (comment)')?.title).toBeNull();
    expect(readHere('https://github.com/acme/web/discussions/4')).toMatchObject({ noun: 'discussion', ref: '#4' });
    expect(readHere('https://git.acme.dev/acme/api/issues/9')).toMatchObject({ ref: 'api#9' });
    expect(readHere('https://git.acme.dev/other/api/issues/9')).toMatchObject({ ref: 'other/api#9' });
  });

  it('keeps an issue and a pull request of one number together, and never lists the pull request itself', () => {
    expect(relatedLinksFrom([{ href: 'https://github.com/acme/web/issues/12', text: '#12' }, { href: 'https://github.com/acme/web/pull/12', text: '#12' }], options)).toHaveLength(1);
    expect(readHere('https://github.com/acme/web/pull/7/files')).toBeNull();
    expect(readHere('https://github.com/ACME/Web/pull/7')).toBeNull();
  });

  it('lists pull requests before issues and discussions, each from this repository, then its owner’s, then elsewhere', () => {
    const links = relatedLinksFrom(
      [
        { href: 'https://github.com/vercel/next.js/issues/1', text: '' },
        { href: 'https://github.com/acme/web/issues/12', text: '' },
        { href: 'https://github.com/acme/web/discussions/4', text: '' },
        { href: 'https://linear.app/acme/issue/ENG-1', text: '' },
        { href: 'https://github.com/vercel/next.js/pull/52514', text: '' },
        { href: 'https://github.com/acme/api/pull/5', text: '' },
        { href: 'https://github.com/acme/web/pull/3', text: '' },
        { href: 'https://github.com/acme/api/issues/8', text: '' },
      ],
      options,
    );
    expect(links.map((link) => link.ref)).toEqual(['#3', 'api#5', 'vercel/next.js#52514', '#12', 'api#8', 'vercel/next.js#1', '#4', 'ENG-1']);
  });

  it('keeps a discussion numbered like the pull request being read', () => {
    expect(readHere('https://github.com/acme/web/discussions/7')).toMatchObject({ noun: 'discussion', ref: '#7' });
  });

  it('tells an Enterprise page’s references from github.com’s of the same name and number', () => {
    const enterprise = { githubHosts: ['git.acme.dev'], repository: 'acme/web', self: 'acme/web#7', host: 'git.acme.dev' };
    expect(relatedLinkOf({ href: 'https://git.acme.dev/acme/web/pull/7', text: '' }, enterprise)).toBeNull();
    expect(relatedLinkOf({ href: 'https://github.com/acme/web/pull/7', text: '' }, enterprise)).toMatchObject({ ref: 'acme/web#7', context: 'acme/web' });
    expect(relatedLinkOf({ href: 'https://git.acme.dev/acme/web/issues/12', text: '' }, enterprise)).toMatchObject({ ref: '#12', context: 'git.acme.dev/acme/web' });
    const both = relatedLinksFrom([{ href: 'https://git.acme.dev/acme/web/issues/12', text: '' }, { href: 'https://github.com/acme/web/issues/12', text: '' }], enterprise);
    expect(both.map((link) => link.ref)).toEqual(['#12', 'acme/web#12']);
  });

  it('leaves the rest of GitHub alone', () => {
    for (const href of ['https://github.com/acme/web', 'https://github.com/acme/web/commit/3b2f94ba', 'https://github.com/acme/web/blob/main/a.ts', 'https://github.com/orgs/acme/discussions/1', 'https://github.com/acme/web/issues', 'https://github.com/user-attachments/assets/b72f2dc7-4558-488d-877c-eb53a7f4beef']) {
      expect(readHere(href), href).toBeNull();
    }
  });
});

describe('official sources in comments', () => {
  const fromComment = (href: string, author: string) => relatedLinkOf({ href, text: '', author });

  it('takes a comment’s link only when its author is that service’s own bot', () => {
    expect(fromComment('https://linear.app/wulfgardr/issue/WUL-766', 'linear[bot]')?.ref).toBe('WUL-766');
    expect(fromComment('https://linear.app/wulfgardr/issue/WUL-766', 'octocat')).toBeNull();
    expect(fromComment('https://welibrary.atlassian.net/browse/LC-12', 'atlassian[bot]')?.ref).toBe('LC-12');
    expect(fromComment('https://app.replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010', 'replicas-connector[bot]')?.noun).toBe('workspace');
    expect(fromComment('https://app.replicas.dev/automations/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010', 'replicas-connector[bot]')?.noun).toBe('automation');
    expect(fromComment('https://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac', 'devin-ai-integration[bot]')?.noun).toBe('session');
    expect(fromComment('https://codegen.com/agent/trace/171445', 'codegen-sh[bot]')?.noun).toBe('run');
  });

  it('takes nothing a bot says of another service, nor GitHub references', () => {
    expect(fromComment('https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139', 'linear[bot]')).toBeNull();
    expect(fromComment('https://app.greptile.com/review/github/acme/web/pull/9', 'replicas-connector[bot]')).toBeNull();
    expect(fromComment('https://github.com/acme/web/issues/12', 'linear[bot]')).toBeNull();
  });

  it('takes the issue’s title from Linear’s linkback over the author’s words, and the author’s when the linkback has none', () => {
    const description = { href: 'https://linear.app/alt-design/issue/DEV-9627/alt-tools', text: 'DEV-9627 the nav thing' };
    const linkback = {
      href: 'https://linear.app/alt-design/issue/DEV-9627/group-the-alt-addons-under-an-alt-tools-section-in-the-control-panel',
      text: 'DEV-9627 Group the Alt addons under an Alt Tools section in the control panel nav',
      author: 'linear[bot]',
    };
    const titleOf = (candidates: Parameters<typeof relatedLinksFrom>[0]) => relatedLinksFrom(candidates).map((link) => [link.ref, link.title]);
    expect(titleOf([description, linkback])).toEqual([['DEV-9627', 'Group the Alt addons under an Alt Tools section in the control panel nav']]);
    expect(titleOf([linkback, description])).toEqual([['DEV-9627', 'Group the Alt addons under an Alt Tools section in the control panel nav']]);
    const bare = { href: 'https://linear.app/alt-design/issue/DEV-9627', text: 'DEV-9627', author: 'linear[bot]' };
    expect(titleOf([description, bare])).toEqual([['DEV-9627', 'Alt tools']]);
    expect(titleOf([bare, description])).toEqual([['DEV-9627', 'Alt tools']]);
    expect(titleOf([{ ...linkback, author: 'octocat' }, description])).toEqual([['DEV-9627', 'Alt tools']]);
    const worded = { href: 'https://linear.app/alt-design/issue/DEV-9627', text: 'DEV-9627 the nav thing' };
    expect(titleOf([worded, bare])).toEqual([['DEV-9627', 'the nav thing']]);
  });

  it('takes Linear Code’s comment as Linear’s: its issue with the title and its review of this pull request, not of another', () => {
    const author = 'linear-code[bot]';
    const links = relatedLinksFrom(
      [
        { href: 'https://linear.app/acme/issue/ENG-12/fix-the-sdk-nav', text: 'ENG-12 Fix the SDK nav', author },
        { href: 'https://linear.app/acme/review/fix-the-sdk-nav-0a1b2c3d4e5f', text: 'acme/web#40', author },
        { href: 'https://linear.app/acme/review/feat-api-read-the-nav-from-the-sdk-6f5e4d3c2b1a', text: 'acme/api#7', author },
        { href: 'https://linear.app/acme/review/fix-the-sdk-nav-0a1b2c3d4e5f?openGuide=true', text: 'Review in Linear', author },
      ],
      { repository: 'acme/web', self: 'acme/web#40' },
    );
    expect(links.map((link) => [link.ref, link.title, link.action])).toEqual([
      ['ENG-12', 'Fix the SDK nav', 'Open issue in Linear'],
      [null, null, 'Open review in Linear'],
    ]);
  });

  it('keeps a review of another pull request the author linked, whatever its words', () => {
    const options = { repository: 'acme/web', self: 'acme/web#40' };
    const graphite = { href: 'https://app.graphite.dev/github/pr/acme/api/7', text: 'acme/api#7' };
    expect(relatedLinksFrom([graphite], options).map((link) => [link.service, link.title])).toEqual([['Graphite', 'acme/api#7']]);
    const linear = { href: 'https://linear.app/acme/review/feat-api-read-the-nav-from-the-sdk-6f5e4d3c2b1a', text: 'acme/api#7' };
    expect(relatedLinksFrom([{ ...linear, author: 'linear-code[bot]' }], options)).toEqual([]);
    expect(relatedLinksFrom([linear, { ...linear, author: 'linear-code[bot]' }], options).map((link) => link.title)).toEqual(['acme/api#7']);
    expect(relatedLinksFrom([{ ...linear, author: 'linear-code[bot]' }, linear], options).map((link) => link.title)).toEqual(['acme/api#7']);
  });

  it('reads Linear’s review of the pull request, under its linkback', () => {
    const review = fromComment('https://linear.app/alt-design/review/link-the-settings-page-from-alt-tools-in-the-control-panel-nav-169931068019?openGuide=true', 'linear[bot]');
    expect(review).toMatchObject({ kind: 'review', service: 'Linear', noun: 'review', title: null, action: 'Open review in Linear' });
    expect(review?.key).not.toBe(fromComment('https://linear.app/alt-design/issue/DEV-9627', 'linear[bot]')?.key);
  });
});

describe('Microsoft Teams', () => {
  it('keeps two messages of one thread apart, and one message linked twice as one', () => {
    const thread = 'https://teams.microsoft.com/l/message/19:abc@thread.tacv2';
    const links = relatedLinksFrom([
      { href: `${thread}/1700000000001?tenantId=t`, text: '' },
      { href: `${thread}/1700000000002?tenantId=t`, text: '' },
      { href: `${thread}/1700000000001?groupId=g`, text: '' },
    ]);
    expect(links.map((link) => link.href)).toEqual([`${thread}/1700000000001?tenantId=t`, `${thread}/1700000000002?tenantId=t`]);
  });
});

describe('isDependencyUpdate', () => {
  it('knows Renovate’s and Dependabot’s descriptions, and nothing else', () => {
    expect(isDependencyUpdate('This PR contains the following updates:\n| Package | Change |')).toBe(true);
    expect(isDependencyUpdate('Bumps lodash from 4.17.20 to 4.17.21.')).toBe(true);
    expect(isDependencyUpdate('Bumps the npm_and_yarn group with 3 updates in the / directory')).toBe(true);
    expect(isDependencyUpdate('Fixes the nav. Bumps up the font size a little.')).toBe(false);
    expect(isDependencyUpdate('Fixes ENG-12. Bumps zod from 3 to 4 to unblock this.')).toBe(false);
    expect(isDependencyUpdate('\n  Bumps lodash from 4.17.20 to 4.17.21.')).toBe(true);
    expect(isDependencyUpdate("Dependency updates are known by Renovate's \"This PR contains the following updates\" and Dependabot's \"Dependabot will resolve any conflicts\".")).toBe(false);
    expect(isDependencyUpdate("Release notes…\nDependabot will resolve any conflicts with this PR as long as you don't alter it yourself.")).toBe(true);
  });
});

describe('relatedLinksFrom', () => {
  it('keeps a Sentry issue over the event page of it linked first', () => {
    const links = relatedLinksFrom([
      { href: 'https://sentry.io/organizations/warpdotdev/issues/7259255054/events/05f4453e8d4348d3ad08bf4560a58451/', text: '' },
      { href: 'https://sentry.io/organizations/warpdotdev/issues/7259255054/', text: '' },
    ]);
    expect(links.map((link) => link.href)).toEqual(['https://sentry.io/organizations/warpdotdev/issues/7259255054/']);
  });

  it('keeps one link per thing, the web page over the desktop deep link, in kind order', () => {
    const links = relatedLinksFrom([
      { href: 'https://cursor.com/background-agent?bcId=bc-4507257a-6c22-519d-8c1e-408ad9f0bf88&cursor_ref=pr_footer', text: 'Open in Cursor' },
      { href: 'https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88?cursor_ref=pr_footer', text: 'Open in Web' },
      { href: 'https://app.devin.ai/desktop/session/d71d660849c3422eadd668dd12739bac?variant=devin', text: '' },
      { href: 'https://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac', text: '' },
      { href: 'https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&cid=C0BCMJ9JFA9', text: 'Slack Thread' },
      { href: 'https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139', text: '' },
      { href: 'https://linear.app/acme/issue/ENG-12', text: 'ENG-12' },
      { href: 'https://linear.app/acme/issue/ENG-12/fix-the-sdk-nav', text: '' },
      { href: 'https://github.com/acme/web/pull/3', text: '#3' },
    ]);
    expect(links.map((link) => [link.key, link.href])).toEqual([
      ['github:acme/web#3', 'https://github.com/acme/web/pull/3'],
      ['linear:acme:ENG-12', 'https://linear.app/acme/issue/ENG-12'],
      ['slack:mintlify:C0BCMJ9JFA9:1793123214.352139', 'https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&cid=C0BCMJ9JFA9'],
      ['cursor:bc-4507257a-6c22-519d-8c1e-408ad9f0bf88', 'https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88?cursor_ref=pr_footer'],
      ['devin:d71d660849c3422eadd668dd12739bac', 'https://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac'],
    ]);
    expect(links[1]?.title).toBe('Fix the sdk nav');
  });
});

describe('slugTitle', () => {
  it('reads a slug as words and refuses ids', () => {
    expect(slugTitle('fix-the-sdk-nav')).toBe('Fix the sdk nav');
    expect(slugTitle('Release+checklist')).toBe('Release checklist');
    expect(slugTitle('0123456789abcdef')).toBeNull();
  });
});
