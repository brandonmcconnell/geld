// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Preview } from '@geld/review';
import type { Deployment } from './deployments';
import { deploymentEntries, deploymentHref, deploymentMark, deploymentOf, deploymentsOfPreview, latestDeployments, pinnedToBuild, previewLinks } from './deployments';
import { deploymentPill } from './panel';

// Trimmed from tldraw/tldraw#11342 and #11388, signed out, Nov 2026.
const VIA_ACTIONS = `
<div id="event-35352475592" class="TimelineItem js-targetable-element">
  <div class="TimelineItem-badge"><svg class="octicon octicon-rocket"></svg></div>
  <div class="TimelineItem-body"><div class="d-flex">
    <div class="flex-shrink-0 mr-1"><a class="d-inline-block" data-test-selector="pr-timeline-events-actor-avatar" data-hovercard-type="user" data-hovercard-url="/users/kaneel/hovercard" href="/kaneel"><img class="avatar avatar-user" src="https://avatars.githubusercontent.com/u/1?s=40" width="20" height="20" alt="@kaneel" /></a></div>
    <div class="flex-auto d-flex flex-column flex-md-row"><div class="flex-auto">
      <a class="author Link--primary text-bold" data-test-selector="pr-timeline-events-actor-profile-link" data-hovercard-type="user" data-hovercard-url="/users/kaneel/hovercard" href="/kaneel">kaneel</a>
      <a target="_blank" class="Link--secondary" rel="noopener noreferrer" href="https://github.com/tldraw/tldraw/actions/runs/42368203634/job/128390665211">temporarily deployed</a>
      to
        bemo-canary
      <a href="#event-35352475592" class="css-truncate css-truncate-target Link--secondary Link"><relative-time tense="past" datetime="2026-11-06T13:40:02Z">November 6, 2026 13:40</relative-time></a>            &mdash; with <img src="https://avatars.githubusercontent.com/in/15368?s=40" width="16" height="16" alt="" class="avatar">
      <a href="https://github.com/apps/github-actions" class="Link--primary text-bold">GitHub Actions</a>
      <span title="Deployment Status Label: Inactive" class="Label Label--secondary">Inactive</span>
    </div></div>
  </div></div>
</div>`;

const VERCEL_FAILED = `
<div id="event-35348458584" class="TimelineItem js-targetable-element">
  <div class="TimelineItem-badge"><svg class="octicon octicon-rocket"></svg></div>
  <div class="TimelineItem-body"><div class="d-flex">
    <div class="flex-shrink-0 mr-1"><a class="d-inline-block" data-test-selector="pr-timeline-events-actor-avatar" href="/apps/vercel"><img class="avatar" src="https://avatars.githubusercontent.com/in/8329?s=40" width="20" height="20" alt="@vercel" /></a></div>
    <div class="flex-auto d-flex flex-column flex-md-row"><div class="flex-auto">
      <a class="author Link--primary text-bold" data-test-selector="pr-timeline-events-actor-profile-link" href="/apps/vercel">vercel</a>
      <span class="Label Label--secondary">Bot</span>
      <a title="Deployment has failed" target="_blank" class="Link--secondary" rel="noopener noreferrer" href="https://examples-r2fi9yu5m.tldraw.club">had a problem deploying</a>
      to
        <a href="https://examples-r2fi9yu5m.tldraw.club" class="Link--primary Link text-bold">Preview – examples</a>
      <a href="#event-35348458584" class="css-truncate css-truncate-target Link--secondary Link"><relative-time tense="past" datetime="2026-11-06T12:49:45Z">November 6, 2026 12:49</relative-time></a>
      <span title="Deployment Status Label: Failure" class="Label Label--danger">Failure</span>
    </div></div>
  </div></div>
</div>`;

const ACTIONS_BOT = `
<div id="event-35352596920" class="TimelineItem js-targetable-element">
  <div class="TimelineItem-badge"><svg class="octicon octicon-rocket"></svg></div>
  <div class="TimelineItem-body"><div class="d-flex">
    <div class="flex-shrink-0 mr-1"><a class="d-inline-block" data-test-selector="pr-timeline-events-actor-avatar" href="/apps/github-actions"><img class="avatar" src="https://avatars.githubusercontent.com/in/15368?s=40" width="20" height="20" alt="@github-actions" /></a></div>
    <div class="flex-auto d-flex flex-column flex-md-row"><div class="flex-auto">
      <a class="author Link--primary text-bold" data-test-selector="pr-timeline-events-actor-profile-link" href="/apps/github-actions">github-actions</a>
      <span class="Label Label--secondary">Bot</span>
      deployed
      to
        <a href="https://pr-11342-demo.tldraw.xyz" class="Link--primary Link text-bold">bemo-preview</a>
      <a href="#event-35352596920" class="css-truncate css-truncate-target Link--secondary Link"><relative-time tense="past" datetime="2026-11-06T13:41:00Z">November 6, 2026 13:41</relative-time></a>
    </div>
    <div class="text-right"><a href="https://pr-11342-demo.tldraw.xyz" class="btn btn-sm">View deployment</a></div>
    </div>
  </div></div>
</div>`;

function row(markup: string): Element {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const node = host.firstElementChild;
  if (node === null) throw new Error('no row');
  return node;
}

function read(markup: string): Deployment {
  const deployment = deploymentOf(row(markup));
  if (deployment === null) throw new Error('not read as a deployment');
  return deployment;
}

describe('deploymentOf', () => {
  it('reads a person deploying through GitHub Actions', () => {
    expect(read(VIA_ACTIONS)).toEqual({
      anchor: 'event-35352475592',
      environment: 'bemo-canary',
      state: 'inactive',
      url: null,
      logUrl: 'https://github.com/tldraw/tldraw/actions/runs/42368203634/job/128390665211',
      actor: 'kaneel',
      actorAvatar: 'https://avatars.githubusercontent.com/u/1?s=40',
      via: { name: 'GitHub Actions', avatarSrc: 'https://avatars.githubusercontent.com/in/15368?s=40' },
      at: '2026-11-06T13:40:02Z',
    });
  });

  it('reads a failed deployment by an App', () => {
    const deployment = read(VERCEL_FAILED);
    expect(deployment.environment).toBe('Preview – examples');
    expect(deployment.state).toBe('failed');
    expect(deployment.url).toBe('https://examples-r2fi9yu5m.tldraw.club/');
    expect(deployment.logUrl).toBeNull();
    expect(deployment.actor).toBe('vercel[bot]');
    expect(deployment.via).toBeNull();
  });

  it('reads an active deployment with a View deployment button', () => {
    const deployment = read(ACTIONS_BOT);
    expect(deployment.environment).toBe('bemo-preview');
    expect(deployment.state).toBe('active');
    expect(deployment.url).toBe('https://pr-11342-demo.tldraw.xyz/');
    expect(deploymentMark(deployment)).toBe('https://avatars.githubusercontent.com/in/15368?s=40');
  });

  it('takes an App linking "deployed" to its site for the address, not a run', () => {
    const ignored = VERCEL_FAILED.replace('had a problem deploying', 'temporarily deployed').replace(/<a href="https:\/\/examples-r2fi9yu5m\.tldraw\.club" class="Link--primary Link text-bold">Preview – examples<\/a>/, 'Preview – workflow-template').replace('Failure</span>', 'Inactive</span>').replace('Deployment Status Label: Failure', 'Deployment Status Label: Inactive');
    const deployment = read(ignored);
    expect(deployment.environment).toBe('Preview – workflow-template');
    expect(deployment.state).toBe('inactive');
    expect(deployment.url).toBe('https://examples-r2fi9yu5m.tldraw.club/');
    expect(deployment.logUrl).toBeNull();
  });

  it('leaves other events alone', () => {
    expect(deploymentOf(row('<div id="event-1" class="TimelineItem"><div class="TimelineItem-body"><a class="author" href="/a">a</a> added the bug label</div></div>'))).toBeNull();
  });
});

describe('latestDeployments', () => {
  it('keeps each environment once, by its latest deployment, counting the rest', () => {
    const base = read(ACTIONS_BOT);
    const at = (anchor: string, environment: string): Deployment => ({ ...base, anchor, environment });
    const groups = latestDeployments([at('event-1', 'bemo-canary'), at('event-2', 'bemo-preview'), at('event-3', 'bemo-canary')]);
    expect(groups.map((group) => [group.latest.anchor, group.count])).toEqual([
      ['event-2', 1],
      ['event-3', 2],
    ]);
  });
});

describe('previews and deployments', () => {
  const vercel = (anchor: string, environment: string, state: Deployment['state'], url: string | null, at: string): Deployment => ({ ...read(VERCEL_FAILED), anchor, environment, state, url, at });
  const examples: Preview = { host: 'vercel', project: 'examples', status: 'failed', url: null, inspectUrl: 'https://vercel.com/tldraw/examples/91Y2', anchor: 'issuecomment-1' };
  const docs: Preview = { ...examples, project: 'tldraw-docs', status: 'ready', url: 'https://tldraw-docs-git-branch.tldraw.club', inspectUrl: 'https://vercel.com/tldraw/tldraw-docs/5Vum' };
  const all = [
    vercel('event-1', 'Preview – examples', 'active', 'https://examples-good.tldraw.club', '2026-11-06T12:00:00Z'),
    vercel('event-2', 'Preview – tldraw-docs', 'active', 'https://tldraw-docs-abc.tldraw.club', '2026-11-06T12:01:00Z'),
    vercel('event-3', 'Preview – examples', 'failed', 'https://examples-bad.tldraw.club', '2026-11-06T13:40:00Z'),
    read(VIA_ACTIONS),
  ];

  it('matches a preview to the environment named after its project', () => {
    expect(deploymentsOfPreview(examples, [examples, docs], all).map((deployment) => deployment.anchor)).toEqual(['event-1', 'event-3']);
  });

  it('gives an environment to the longest project name it ends in', () => {
    const short: Preview = { ...examples, project: 'docs' };
    expect(deploymentsOfPreview(short, [short, docs], all)).toEqual([]);
    expect(deploymentsOfPreview(docs, [short, docs], all).map((deployment) => deployment.anchor)).toEqual(['event-2']);
  });

  it('falls back to the newest archived success, the archive being newest first', () => {
    const netlify: Preview = { host: 'netlify', project: 'site', status: 'failed', url: null, inspectUrl: null, anchor: 'issuecomment-9' };
    const archived: Preview[] = [
      { ...netlify, status: 'ready', url: 'https://newer.netlify.app', anchor: 'issuecomment-8' },
      { ...netlify, status: 'ready', url: 'https://older.netlify.app', anchor: 'issuecomment-7' },
    ];
    expect(previewLinks(netlify, { latest: [netlify], archived }, []).lastSuccess).toBe('https://newer.netlify.app');
  });

  it('matches a host with one project and one environment by that alone', () => {
    const single: Preview = { ...docs, project: 'nodejs-org' };
    const preview = [vercel('event-9', 'Preview', 'active', 'https://nodejs-k9a.vercel.app', '2026-11-06T17:22:00Z')];
    expect(deploymentsOfPreview(single, [single], preview).map((deployment) => deployment.anchor)).toEqual(['event-9']);
    expect(deploymentsOfPreview(single, [single, examples], preview)).toEqual([]);
  });

  it('opens a failed preview on its last good build, and says so', () => {
    expect(previewLinks(examples, { latest: [examples, docs], archived: [] }, all)).toEqual({ href: 'https://examples-good.tldraw.club', lastSuccess: 'https://examples-good.tldraw.club' });
    expect(previewLinks(docs, { latest: [examples, docs], archived: [] }, all)).toEqual({ href: 'https://tldraw-docs-git-branch.tldraw.club', lastSuccess: null });
  });

  it('falls back to the host page for a failed preview that never had a good build', () => {
    expect(previewLinks(examples, { latest: [examples], archived: [] }, [])).toEqual({ href: 'https://vercel.com/tldraw/examples/91Y2', lastSuccess: null });
  });

  it('gives a deployment its host page from the comment, and a GitHub Actions one its run', () => {
    const entries = deploymentEntries(all, [examples, docs]);
    const failed = entries.find((entry) => entry.latest.anchor === 'event-3');
    const canary = entries.find((entry) => entry.latest.environment === 'bemo-canary');
    expect(failed === undefined ? null : deploymentHref(failed)).toBe('https://vercel.com/tldraw/examples/91Y2');
    expect(failed?.comment).toBe('issuecomment-1');
    expect(canary === undefined ? null : deploymentHref(canary)).toBe('https://github.com/tldraw/tldraw/actions/runs/42368203634/job/128390665211');
    expect(canary?.comment).toBeNull();
  });

  it('pins an earlier push preview to the build GitHub recorded by then', () => {
    const earlier: Preview = { ...examples, status: 'ready', url: 'https://examples-git-branch.tldraw.club', updatedAt: '2026-11-06T12:00:30Z' };
    expect(pinnedToBuild(earlier, deploymentsOfPreview(earlier, [examples], all)).url).toBe('https://examples-good.tldraw.club');
  });
});

describe('deployment pill', () => {
  const entry = (deployment: Deployment): Parameters<typeof deploymentPill>[0] => ({ latest: deployment, count: 1, page: null, comment: null, lastSuccessRun: null });

  it('opens a deployment off GitHub in a new tab', () => {
    const pill = deploymentPill(entry(read(ACTIONS_BOT)));
    expect(pill.getAttribute('href')).toBe('https://pr-11342-demo.tldraw.xyz/');
    expect(pill.getAttribute('target')).toBe('_blank');
  });

  it('opens a run on GitHub where the reader is', () => {
    location.href = 'https://github.com/tldraw/tldraw/pull/11342';
    const pill = deploymentPill(entry(read(VIA_ACTIONS)));
    expect(pill.getAttribute('href')).toContain('/actions/runs/');
    expect(pill.hasAttribute('target')).toBe(false);
  });
});
