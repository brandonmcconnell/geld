// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Preview } from '@geld/review';
import { previewPill } from './panel';

const logs = 'https://dash.cloudflare.com/?to=/account/workers/services/view/movember-tracker/production/builds/build';
const entry: Preview = { host: 'cloudflare', project: 'movember-tracker', status: 'failed', url: null, inspectUrl: logs, anchor: 'issuecomment-1' };
const model = { avatarForAnchor: () => null, previewLinks: (preview: Preview) => ({ href: preview.url ?? preview.inspectUrl, lastSuccess: null }) };

describe('preview pill navigation', () => {
  it('links a failed Cloudflare deployment to its build logs', () => {
    const pill = previewPill(entry, model);
    expect(pill.tagName).toBe('A');
    expect(pill.getAttribute('href')).toBe(logs);
    expect(pill.getAttribute('target')).toBe('_blank');
  });

  it('prefers the preview when one exists', () => {
    expect(previewPill({ ...entry, status: 'ready', url: 'https://preview.example.com' }, model).getAttribute('href')).toBe('https://preview.example.com');
  });

  it('keeps a deployment without either URL inert', () => {
    const pill = previewPill({ ...entry, inspectUrl: null }, model);
    expect(pill.tagName).toBe('SPAN');
    expect(pill.hasAttribute('href')).toBe(false);
  });
});
