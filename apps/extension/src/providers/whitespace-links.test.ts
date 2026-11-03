// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import { ProviderWhitespace } from './whitespace';
import { MAX_WHITESPACE_LINKS, ProviderWhitespaceLinks } from './whitespace-links';

const settings = { ...DEFAULT_SETTINGS, hideWhitespace: true };
const path = 'https://gitlab.com/group/project/-/merge_requests/42/diffs';

function anchor(href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.setAttribute('href', href);
  document.body.append(link);
  return link;
}

beforeEach(() => { document.body.replaceChildren(); document.head.querySelectorAll('base').forEach((base) => base.remove()); window.location.href = path; });

describe('provider whitespace link custody', () => {
  it('restores its exact original href after an opt-out instead of creating a false opt-in', () => {
    const save = vi.fn();
    const planner = new ProviderWhitespace(settings, {}, save);
    const links = new ProviderWhitespaceLinks(planner);
    const original = '/group/project/-/merge_requests/42/diffs?diff_id=812#note_12';
    const link = anchor(original);
    links.prepare(link);
    expect(new URL(link.href).searchParams.get('w')).toBe('1');
    planner.navigation(new URL(`${path}?w=0`));
    links.refresh();
    for (let intent = 0; intent < 3; intent++) links.prepare(link);
    expect(link.getAttribute('href')).toBe(original);
    expect(planner.navigation(new URL(link.href))).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(save.mock.calls[0]?.[0] ?? {})).toHaveLength(1);
    links.dispose();
  });

  it.each(['0', '1'])('preserves native explicit w=%s, including later retirement', (w) => {
    const links = new ProviderWhitespaceLinks(new ProviderWhitespace(settings, {}, () => undefined));
    const original = `${path}?w=${w}&diff_id=812#note_12`;
    const link = anchor(original);
    links.prepare(link);
    links.refresh();
    links.dispose();
    expect(link.getAttribute('href')).toBe(original);
  });

  it.each([
    `${path}?w=1&diff_id=913#note_14`,
    `${path}?diff_id=913&start_sha=${'a'.repeat(40)}#note_14`,
    `${path.replace('/42/', '/43/')}?w=1`,
    'https://bitbucket.org/group/project/pull-requests/42/diff?w=1',
    'https://example.com/group/project/-/merge_requests/42/diffs?w=1',
  ])('relinquishes custody when another writer changes the href to %s', (changed) => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const link = anchor(path);
    links.prepare(link);
    link.setAttribute('href', changed);
    planner.navigation(new URL(`${path}?w=0`));
    links.refresh();
    links.dispose();
    expect(link.getAttribute('href')).toBe(changed);
  });

  it.each(['master', 'whitespace', 'repository'])('restores after %s policy disable and prepares a fresh edit only after re-enable and intent', (policy) => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const link = anchor(path);
    links.prepare(link);
    planner.update(policy === 'master' ? { ...settings, enabled: false } : policy === 'whitespace' ? { ...settings, hideWhitespace: false } : { ...settings, repoRules: ['gitlab.com/group/**'] });
    links.refresh();
    expect(link.getAttribute('href')).toBe(path);
    links.prepare(link);
    expect(link.getAttribute('href')).toBe(path);
    planner.update(settings);
    links.prepare(link);
    expect(link.href).toBe(`${path}?w=1`);
    links.dispose();
    expect(link.getAttribute('href')).toBe(path);
    links.prepare(link);
    expect(link.getAttribute('href')).toBe(path);
  });

  it('uses each original destination rather than the new source route when reviewing policy', () => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const first = anchor(path);
    const otherPath = path.replace('/42/', '/43/');
    const other = anchor(otherPath);
    links.prepare(first);
    links.prepare(other);
    window.location.href = `${otherPath}?w=0`;
    planner.navigation(new URL(window.location.href));
    links.refresh();
    expect(first.href).toBe(`${path}?w=1`);
    expect(other.href).toBe(otherPath);
    links.dispose();
  });

  it.each(['?diff_id=812#note_12', '#note_12'])('releases a relative %s rewrite when the original anchor survives an SPA route change', (original) => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const link = anchor(original);
    links.prepare(link);
    expect(new URL(link.href).pathname).toContain('/42/');
    window.history.replaceState(null, '', path.replace('/42/', '/43/'));
    links.refresh();
    expect(link.getAttribute('href')).toBe(original);
    expect(new URL(link.href).pathname).toContain('/43/');
    links.prepare(link);
    expect(new URL(link.href).pathname).toContain('/43/');
    expect(new URL(link.href).searchParams.get('w')).toBe('1');
    links.dispose();
  });

  it('releases relative custody after a native base URI change while preserving absolute destinations', () => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const relative = anchor('?diff_id=812#note_12');
    const absolute = anchor(path);
    links.prepare(relative);
    links.prepare(absolute);
    const base = document.createElement('base');
    base.href = path.replace('/42/', '/43/');
    document.head.append(base);
    links.refresh();
    expect(relative.getAttribute('href')).toBe('?diff_id=812#note_12');
    expect(new URL(relative.getAttribute('href') ?? '', relative.baseURI).pathname).toContain('/43/');
    expect(absolute.href).toBe(`${path}?w=1`);
    links.prepare(relative);
    expect(new URL(relative.href).pathname).toContain('/43/');
    expect(new URL(relative.href).searchParams.get('w')).toBe('1');
    links.dispose();
  });

  it('prunes detached anchors by restoring exact owned values before a possible native remount', () => {
    const planner = new ProviderWhitespace(settings, {}, () => undefined);
    const links = new ProviderWhitespaceLinks(planner);
    const link = anchor(path);
    links.prepare(link);
    link.remove();
    links.refresh();
    expect(link.getAttribute('href')).toBe(path);
    planner.navigation(new URL(`${path}?w=0`));
    document.body.append(link);
    links.prepare(link);
    expect(link.getAttribute('href')).toBe(path);
    links.dispose();
  });

  it.each(['refresh', 'dispose'])('relinquishes an adopted anchor without restoring another Document during %s', (action) => {
    const links = new ProviderWhitespaceLinks(new ProviderWhitespace(settings, {}, () => undefined));
    const link = anchor(path);
    links.prepare(link);
    const written = link.getAttribute('href');
    const otherDocument = document.implementation.createHTMLDocument('Other page');
    otherDocument.body.append(otherDocument.adoptNode(link));
    expect(link.ownerDocument).toBe(otherDocument);
    if (action === 'refresh') links.refresh();
    links.dispose();
    expect(link.getAttribute('href')).toBe(written);
  });

  it('bounds retained anchors without leaving forgotten Geld query parameters behind', () => {
    const links = new ProviderWhitespaceLinks(new ProviderWhitespace(settings, {}, () => undefined));
    const all = Array.from({ length: MAX_WHITESPACE_LINKS + 1 }, () => anchor(path));
    for (const link of all) links.prepare(link);
    expect(all[0]?.getAttribute('href')).toBe(path);
    expect(all.at(-1)?.href).toBe(`${path}?w=1`);
    links.dispose();
    expect(all.every((link) => link.getAttribute('href') === path)).toBe(true);
  });
});
