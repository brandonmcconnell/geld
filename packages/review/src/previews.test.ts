import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { latestPreviews, parsePreviews, previewDocFromMarkdown, vercelHeader } from './previews';

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/previews/${name}.md`, import.meta.url), 'utf8');
}

function parse(name: string, author: string, anchor = 'issuecomment-1') {
  return parsePreviews(previewDocFromMarkdown(author, anchor, fixture(name)));
}

describe('parsePreviews', () => {
  it('reads Vercel from its hidden header: every project, status, preview and inspector', () => {
    const found = parse('vercel-ready', 'vercel[bot]');
    expect(found.length).toBeGreaterThan(0);
    const docs = found.find((entry) => entry.project === 'develop-docs');
    expect(docs).toMatchObject({ host: 'vercel', status: 'ready', url: 'https://develop-docs-git-jp-claude-md.sentry.dev' });
    expect(docs?.inspectUrl).toMatch(/^https:\/\/vercel\.com\/sentry\/develop-docs\//);
  });

  it('reads Vercel from the rendered table when the header is gone', () => {
    const md = fixture('vercel-ready').replace(/^\[vc\]:.*$/m, '');
    expect(vercelHeader(md)).toBeNull();
    const found = parsePreviews(previewDocFromMarkdown('vercel[bot]', 'issuecomment-1', md));
    const docs = found.find((entry) => entry.project === 'develop-docs');
    expect(docs).toMatchObject({ status: 'ready', url: 'https://develop-docs-git-jp-claude-md.sentry.dev' });
  });

  it('marks skipped Vercel deployments and keeps their inspector link', () => {
    const found = parse('vercel-skipped', 'vercel[bot]');
    expect(found.length).toBe(5);
    expect(found.every((entry) => entry.status === 'skipped' && entry.url === null && entry.inspectUrl !== null)).toBe(true);
    expect(found.map((entry) => entry.project)).toContain('design-system');
  });

  it('treats "attempting to deploy" as a pending preview', () => {
    const found = parse('vercel-authorize', 'vercel[bot]');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ host: 'vercel', status: 'building', url: null });
  });

  it('reads Netlify: site, deploy preview, deploy log', () => {
    const [found] = parse('netlify', 'netlify[bot]');
    expect(found).toMatchObject({ host: 'netlify', project: 'astro-starlight', status: 'ready', url: 'https://deploy-preview-4208--astro-starlight.netlify.app' });
    expect(found?.inspectUrl).toMatch(/app\.netlify\.com\/projects\/astro-starlight\/deploys\//);
  });

  it('reads Cloudflare Pages and the Workers table', () => {
    const [pages] = parse('cloudflare', 'cloudflare-workers-and-pages[bot]');
    expect(pages).toMatchObject({ host: 'cloudflare', project: 'alloflow-cdn', status: 'ready', url: 'https://f2d0538d.alloflow-cdn.pages.dev' });
    const [workers] = parse('cloudflare-workers', 'cloudflare-workers-and-pages[bot]');
    expect(workers).toMatchObject({ host: 'cloudflare', project: 'alloflow-cdn', status: 'failed' });
    expect(workers?.inspectUrl).toMatch(/dash\.cloudflare\.com/);
  });

  it('reads Mintlify, Railway, Render, Amplify, Azure, Read the Docs, Chromatic and a preview Action', () => {
    expect(parse('mintlify', 'mintlify[bot]')[0]).toMatchObject({ host: 'mintlify', project: 'mintlify', status: 'ready', url: 'https://mintlify-mintlify-beac9b2f.mintlify.site/agent/slack' });
    expect(parse('railway', 'railway-app[bot]')[0]).toMatchObject({ host: 'railway', project: 'Docs Frontend', status: 'ready', url: 'https://docs-frontend-docs-pr-1351.up.railway.app' });
    expect(parse('render', 'render[bot]')[0]).toMatchObject({ host: 'render', status: 'ready', url: 'https://api-3i-shikosai32-dev-pr-320.onrender.com' });
    expect(parse('amplify', 'aws-amplify-us-east-1[bot]')[0]).toMatchObject({ host: 'amplify', status: 'ready', url: 'https://pr-237.d1sbzu1fk07gu2.amplifyapp.com' });
    expect(parse('azure-swa', 'github-actions[bot]')[0]).toMatchObject({ host: 'azure-swa', status: 'ready', url: 'https://brave-bay-04f351e03-128.westeurope.4.azurestaticapps.net' });
    expect(parse('readthedocs', 'read-the-docs-community[bot]')[0]).toMatchObject({ host: 'readthedocs', project: 'dev', status: 'ready', url: 'https://readthedocs-landing--13317.org.readthedocs.build/dev/13317/' });
    expect(parse('chromatic', 'chromatic-com-staging[bot]')[0]).toMatchObject({ host: 'chromatic', project: 'Storybook', status: 'ready' });
    expect(parse('surge-action', 'github-actions[bot]')[0]).toMatchObject({ host: 'generic', status: 'ready', url: 'https://bwdrebing-Eden-preview-pr-53.surge.sh' });
  });

  it('reads Mintlify from a rendered table (rows as pipe lines, links separately)', () => {
    const found = parsePreviews({
      author: 'mintlify[bot]',
      anchor: 'issuecomment-622',
      text: 'Preview deployment for your docs. Learn more about Mintlify Previews.\n| Project | Status | Preview | Updated |\n| kb | 🟢 Ready | View Preview | Sep 19, 2026, 7:42 PM |',
      links: [
        { href: 'https://www.mintlify.com/docs/deploy/preview-deployments', text: 'Mintlify Previews' },
        { href: 'https://app.mintlify.com/mintlify/kb?section=previews', text: 'kb' },
        { href: 'https://mintlify-kb-abc123.mintlify.site/', text: 'View Preview' },
      ],
      images: [],
    });
    expect(found[0]).toMatchObject({ host: 'mintlify', project: 'kb', status: 'ready', url: 'https://mintlify-kb-abc123.mintlify.site/' });
  });

  it('ignores bot comments that are not about previews', () => {
    expect(parsePreviews(previewDocFromMarkdown('github-actions[bot]', 'issuecomment-9', '⚠️ getStaticProps changed? Please double check.'))).toEqual([]);
    expect(parsePreviews(previewDocFromMarkdown('cursor[bot]', 'issuecomment-9', 'Bugbot reviewed your changes and found no new issues!'))).toEqual([]);
  });
});

describe('latestPreviews', () => {
  it('keeps the newest per host+project and archives the rest, newest first', () => {
    const older = parse('netlify', 'netlify[bot]', 'issuecomment-1');
    const newer = parse('netlify', 'netlify[bot]', 'issuecomment-2');
    const other = parse('mintlify', 'mintlify[bot]', 'issuecomment-3');
    const { latest, archived } = latestPreviews([...older, ...newer, ...other]);
    expect(latest.map((entry) => entry.anchor)).toEqual(['issuecomment-2', 'issuecomment-3']);
    expect(archived.map((entry) => entry.anchor)).toEqual(['issuecomment-1']);
  });
});

describe('Vercel rendered table, as the page shows it', () => {
  it('reads Ignored and any inspector text, and falls back to the row when the inspector says nothing', () => {
    const doc = {
      author: 'vercel[bot]',
      anchor: 'issuecomment-9',
      text: [
        'The latest updates on your projects.',
        '| Project | Deployment | Actions | Updated |',
        '| ui | Ignored | Preview | Sep 17, 2026 |',
        '| dashboard | Visit Preview | Sep 17, 2026 |',
        '| api | ✅ Ready (Inspect) | Sep 17, 2026 |',
      ].join('\n'),
      links: [
        { href: 'https://vercel.com/team/ui', text: 'ui' },
        { href: 'https://vercel.com/team/ui/dep1', text: 'Ignored' },
        { href: 'https://ui-git-x.vercel.app', text: 'Preview' },
        { href: 'https://vercel.com/team/dashboard', text: 'dashboard' },
        { href: 'https://vercel.com/team/dashboard/dep2', text: 'Inspect' },
        { href: 'https://dashboard-git-x.vercel.app', text: 'Visit Preview' },
        { href: 'https://vercel.com/team/api', text: 'api' },
        { href: 'https://vercel.com/team/api/dep3', text: 'Inspect' },
      ],
      images: [{ src: 'https://camo.githubusercontent.com/abc', alt: 'Ignored' }],
    };
    const found = parsePreviews(doc);
    expect(found.find((entry) => entry.project === 'ui')?.status).toBe('skipped');
    expect(found.find((entry) => entry.project === 'dashboard')?.status).toBe('ready');
    expect(found.find((entry) => entry.project === 'api')?.status).toBe('ready');
    expect(found.find((entry) => entry.project === 'api')?.inspectUrl).toBe('https://vercel.com/team/api/dep3');
  });
});
