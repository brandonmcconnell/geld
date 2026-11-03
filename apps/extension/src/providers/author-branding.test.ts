// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderReviewInput } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewAuthorPresentation } from './review-panel';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

const styles = readFileSync(new NodeURL('./style.css', import.meta.url), 'utf8').replace(/^@import[^\n]*\n/, '');
const bitbucketTheme = readFileSync(new NodeURL('../bitbucket/theme.css', import.meta.url), 'utf8');
const gitlabTheme = readFileSync(new NodeURL('../gitlab/theme.css', import.meta.url), 'utf8');

const authorId = '{c3cbd4fd-2494-4a26-a4db-ea02e2cdb5ee}';
const nativeAvatarClasses = '_16jlkb7n _1o9zkb7n _i0dl1osq _1e0c1txw _1bsb1osq _4t3i1osq _2rko1rr0';
const input: ProviderReviewInput = {
  subject: { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', id: '22', headSha: 'a'.repeat(40) },
  threads: [{ id: '471253038', anchor: 'comment-471253038', url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038', resolved: false, outdated: true,
    comments: [{ id: '471253038', anchor: 'comment-471253038', url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038', author: { id: authorId, login: 'native-author' }, body: 'Native source body', createdAt: '2024-02-13T15:46:48.843Z' }],
  }],
};

function mount(presentation: () => ProviderReviewAuthorPresentation) {
  const host = document.createElement('div');
  document.body.append(host);
  return renderProviderReviewPanel(host, input, { authorPresentation: presentation });
}

beforeEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });
afterEach(() => { document.head.replaceChildren(); delete document.documentElement.dataset.geldProvider; document.documentElement.style.cssText = '';  });

describe('native author branding', () => {
  it('contains the observed Bitbucket percentage-fill avatar classes in their own measured slot', () => {
    // Name, dimensions and image classes observed in public PR22/run41342954764.
    document.documentElement.dataset.geldProvider = 'bitbucket';
    const sheet = document.createElement('style');
    sheet.textContent = styles;
    document.head.append(sheet);
    let presentation: ProviderReviewAuthorPresentation = {
      authorId, displayName: 'Oleksandr Kyrdan',
      avatar: { src: 'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/OK-5.png', width: 32, height: 32, className: nativeAvatarClasses },
    };
    const panel = mount(() => presentation);
    const avatar = panel.element.querySelector<HTMLImageElement>('[data-geld-author-avatar]');
    const slot = panel.element.querySelector<HTMLElement>('[data-geld-author-avatar-slot]');
    expect(avatar?.className).toBe(nativeAvatarClasses);
    expect(avatar?.parentElement).toBe(slot);
    expect(slot?.parentElement?.className).toBe('geld-provider-review__byline');
    expect(slot?.style.width).toBe('32px');
    expect(slot?.style.inlineSize).toBe('32px');
    expect(slot?.style.height).toBe('32px');
    expect(slot?.style.blockSize).toBe('32px');
    if (slot === null) throw new Error('Missing measured native avatar slot');
    const slotStyle = getComputedStyle(slot);
    expect(slotStyle.display).toBe('inline-flex');
    expect(slotStyle.position).toBe('relative');
    expect(slotStyle.flexGrow).toBe('0');
    expect(slotStyle.flexShrink).toBe('0');
    expect(slotStyle.alignSelf).toBe('center');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(panel.element.querySelector('[data-geld-author-name]')?.textContent).toBe('Oleksandr Kyrdan');
    expect(panel.element.querySelector('time')?.dateTime).toBe('2024-02-13T15:46:48.843Z');
    presentation = { ...presentation, avatar: { ...presentation.avatar, src: 'https://avatars.example/replaced.png', width: 40, height: 24 } };
    panel.update(input, { authorPresentation: () => presentation });
    const updated = panel.element.querySelector<HTMLElement>('[data-geld-author-avatar-slot]');
    expect(updated?.style.inlineSize).toBe('40px');
    expect(updated?.style.blockSize).toBe('24px');
    expect(panel.element.querySelector('[data-geld-author-avatar]')?.getAttribute('src')).toBe('https://avatars.example/replaced.png');
  });

  it('separates Bitbucket body/medium/default author tokens from small subdued timestamps', () => {
    document.documentElement.dataset.geldProvider = 'bitbucket';
    const sheet = document.createElement('style');
    sheet.textContent = `${styles}\n${bitbucketTheme}`;
    document.head.append(sheet);
    document.documentElement.style.cssText = '--ds-font-body: 400 14px/20px Arial; --ds-font-body-small: 400 12px/16px Arial; --ds-font-weight-medium: 500; --ds-font-weight-bold: 653; --ds-text: #292a2e; --ds-text-subtle: #505258;';
    const style = getComputedStyle(document.documentElement);
    expect(style.getPropertyValue('--geld-provider-author-font')).toBe('400 14px/20px Arial');
    expect(style.getPropertyValue('--geld-provider-author-weight')).toBe('500');
    expect(style.getPropertyValue('--geld-provider-author-text')).toBe('#292a2e');
    expect(style.getPropertyValue('--geld-provider-byline-font')).toBe('400 12px/16px Arial');
    expect(style.getPropertyValue('--geld-provider-text-subtle')).toBe('#505258');
    const panel = mount(() => ({ authorId, displayName: 'Oleksandr Kyrdan' }));
    const name = panel.element.querySelector<HTMLElement>('[data-geld-author-name]');
    expect(name?.style.cssText).toBe('');
    expect(name?.tagName).toBe('STRONG');
    if (name === null) throw new Error('Missing author');
    expect(getComputedStyle(name).fontSize).toBe('14px');
    expect(getComputedStyle(name).lineHeight).toBe('20px');
    expect(getComputedStyle(name).fontWeight).toBe('500');
    expect(getComputedStyle(name).color).toBe('#292a2e');
    document.documentElement.style.setProperty('--ds-text', '#f0f1f2');
    expect(getComputedStyle(name).color).toBe('#f0f1f2');
    expect(panel.element.querySelector('time')?.closest('[data-geld-author-name]')).toBeNull();
    expect(panel.element.querySelector('[data-geld-author-avatar-slot]')).toBeNull();
  });

  it('keeps GitLab byline metrics and inherited native profile color as the author fallback', () => {
    document.documentElement.dataset.geldProvider = 'gitlab';
    const sheet = document.createElement('style');
    sheet.textContent = `${styles}\n${gitlabTheme}`;
    document.head.append(sheet);
    const style = getComputedStyle(document.documentElement);
    expect(style.getPropertyValue('--geld-provider-author-font')).toBe('');
    expect(style.getPropertyValue('--geld-provider-author-weight')).toBe('');
    expect(style.getPropertyValue('--geld-provider-author-text')).toBe('');
    document.documentElement.style.cssText = '--gl-font-weight-normal: 400; --gl-font-size-base: 14px; --gl-line-height-20: 20px; --font-family-sans-serif: Arial;';
    expect(getComputedStyle(document.documentElement).getPropertyValue('--geld-provider-byline-font')).toBe('400 14px/20px Arial');
  });
});
