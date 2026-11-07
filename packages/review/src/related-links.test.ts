import { describe, expect, it } from 'vitest';
import { relatedLinkOf, relatedLinksFrom, slugTitle } from './related-links';

const read = (href: string, text = href) => relatedLinkOf({ href, text });

describe('relatedLinkOf', () => {
  it("reads Replicas' footer: the workspace, the Slack thread it was asked in and its Linear badge", () => {
    expect(read('https://app.replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010', 'Replicas Workspace')).toMatchObject({
      key: 'replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010',
      kind: 'agent',
      service: 'Replicas',
      label: 'workspace',
      title: null,
      action: 'View in Replicas',
      appId: 2176876,
    });
    expect(read('https://replicas.dev/workspaces/9e2a6c22-c7ad-49f7-8219-fe70dd1c8010')?.key).toBe('replicas:9e2a6c22-c7ad-49f7-8219-fe70dd1c8010');
    expect(read('https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&cid=C0BCMJ9JFA9', 'Slack Thread')).toMatchObject({
      key: 'slack:mintlify:C0BCMJ9JFA9:1793123214.352139',
      kind: 'conversation',
      label: 'thread',
      title: null,
      context: 'mintlify',
      action: 'Open in Slack',
    });
    expect(read('https://linear.app/rpd-34/issue/LIM-1391/featstreaming-add-buffered-streamingencoder-wrapper-and-flush-policy', 'Linear LIM-1391')).toMatchObject({
      key: 'linear:rpd-34:LIM-1391',
      kind: 'ticket',
      label: 'LIM-1391',
      title: 'Featstreaming add buffered streamingencoder wrapper and flush policy',
      context: 'rpd-34',
      icon: 'linear',
    });
  });

  it('takes the words of a link as its title only when they say more than the service and label', () => {
    expect(read('https://linear.app/acme/issue/ENG-12', 'ENG-12 Fix the SDK nav')?.title).toBe('Fix the SDK nav');
    expect(read('https://linear.app/acme/issue/ENG-12/fix-the-sdk-nav', 'Fix the SDK nav')?.title).toBe('Fix the SDK nav');
    expect(read('https://linear.app/wulfgardr/issue/WUL-766', 'WUL-766')?.title).toBeNull();
    expect(read('https://linear.app/acme/issue/ENG-12', 'https://linear.app/acme/issue/ENG-12')?.title).toBeNull();
    expect(read('https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88', 'Open in Web')?.title).toBeNull();
  });

  it('tells a Slack thread, a message, a direct message and a channel apart', () => {
    expect(read('https://replicas-group.slack.com/archives/C0C4EG8J4D7/p1793254029666000', 'Slack Thread')?.label).toBe('thread');
    expect(read('https://replicas-group.slack.com/archives/C0C4EG8J4D7/p1793254029666000', 'see here')?.label).toBe('message');
    expect(read('https://superserve-ai.slack.com/archives/D0C8P610CTC/p1793256576237969?thread_ts=1793256576.237969&cid=D0C8P610CTC')?.context).toBe('superserve-ai · direct message');
    expect(read('https://acme.slack.com/archives/C0123ABCD')).toMatchObject({ label: 'channel', context: 'acme' });
    expect(read('https://app.slack.com/client/T06T9CEDK4G/C0123UCREZKP/thread/C0123UCREZKP-1793123214.352139')?.label).toBe('thread');
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
    for (const [href, service, label] of cases) expect(read(href), href).toMatchObject({ kind: 'agent', service, label });
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
    expect(read('https://bro73.atlassian.net/browse/SCRUM-59')).toMatchObject({ key: 'jira:bro73:SCRUM-59', label: 'SCRUM-59', context: 'bro73', action: 'Open in Jira' });
    expect(read('https://acme.atlassian.net/jira/software/projects/ENG/boards/3?selectedIssue=ENG-42')).toMatchObject({ key: 'jira:acme:ENG-42' });
    expect(read('https://acme.atlassian.net/jira/software/projects/ENG/boards/3')).toBeNull();
    expect(read('https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist')).toMatchObject({ service: 'Confluence', title: 'Release checklist' });
    expect(read('https://app.shortcut.com/acme/story/123/fix-login')).toMatchObject({ label: 'sc-123', title: 'Fix login' });
    expect(read('https://www.notion.so/citizenlab/Changelog-How-it-works-0123456789abcdef0123456789abcdef')).toMatchObject({ service: 'Notion', title: 'Changelog How it works' });
    expect(read('https://www.notion.so/my-integrations')).toBeNull();
    expect(read('https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Geld-Design?node-id=1-2')).toMatchObject({ label: 'file', title: 'Geld Design' });
    expect(read('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit')).toMatchObject({ label: 'doc' });
    expect(read('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toMatchObject({ label: 'video' });
    expect(read('https://tita-30.sentry.io/issues/GEOG-2A')).toMatchObject({ kind: 'error', label: 'GEOG-2A', context: 'tita-30' });
    expect(read('https://sentry.io/organizations/warpdotdev/issues/123456/')).toMatchObject({ label: 'issue', context: 'warpdotdev' });
    expect(read('https://linear.app/developers/graphql')).toBeNull();
    expect(read('https://linear.app/acme/project/geld-related-links-0123456789ab/overview')).toMatchObject({ label: 'project', title: 'Geld related links' });
  });
});

describe('relatedLinksFrom', () => {
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
      ['linear:acme:ENG-12', 'https://linear.app/acme/issue/ENG-12'],
      ['slack:mintlify:C0BCMJ9JFA9:1793123214.352139', 'https://mintlify.slack.com/archives/C0BCMJ9JFA9/p1793123214352139?thread_ts=1793123214.352139&cid=C0BCMJ9JFA9'],
      ['cursor:bc-4507257a-6c22-519d-8c1e-408ad9f0bf88', 'https://cursor.com/agents/bc-4507257a-6c22-519d-8c1e-408ad9f0bf88?cursor_ref=pr_footer'],
      ['devin:d71d660849c3422eadd668dd12739bac', 'https://app.devin.ai/sessions/d71d660849c3422eadd668dd12739bac'],
    ]);
    expect(links[0]?.title).toBe('Fix the sdk nav');
  });
});

describe('slugTitle', () => {
  it('reads a slug as words and refuses ids', () => {
    expect(slugTitle('fix-the-sdk-nav')).toBe('Fix the sdk nav');
    expect(slugTitle('Release+checklist')).toBe('Release checklist');
    expect(slugTitle('0123456789abcdef')).toBeNull();
  });
});
