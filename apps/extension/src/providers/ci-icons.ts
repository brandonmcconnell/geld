import type { ProviderReviewCheck, ProviderReviewInput } from '@geld/review';
import { CI_GLYPHS } from './ci-icons-data';

const GITLAB_GLYPHS: Readonly<Record<string, string>> = {
  success: 'status_success_borderless', failed: 'status_failed_borderless', pending: 'status_pending_borderless',
  running: 'status_running_borderless', skipped: 'status_skipped_borderless', canceled: 'status_canceled_borderless',
  manual: 'status_manual_borderless', scheduled: 'status_scheduled_borderless', created: 'status_created_borderless', preparing: 'status_preparing_borderless',
};

export function providerCheckIcon(provider: ProviderReviewInput['subject']['provider'], check: ProviderReviewCheck, doc: Document): HTMLElement | null {
  if (provider !== 'gitlab' && provider !== 'bitbucket') return null;
  if (check.allowFailure === true || check.nativeStatus === undefined) return null;
  if (provider === 'bitbucket' && check.nativeStatus !== 'SUCCESSFUL') return null;
  if (provider === 'gitlab' && !Object.hasOwn(GITLAB_GLYPHS, check.nativeStatus)) return null;
  const name = provider === 'gitlab' ? GITLAB_GLYPHS[check.nativeStatus] : 'bitbucket-check-circle';
  if (name === undefined) return null;
  const glyph = CI_GLYPHS[name];
  if (glyph === undefined) return null;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', glyph.viewBox);
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.geldNativeCheckIcon = name;
  for (const shape of glyph.shapes) {
    const child = doc.createElementNS('http://www.w3.org/2000/svg', shape.tag);
    for (const [key, value] of Object.entries(shape.attributes)) child.setAttribute(key, value);
    svg.append(child);
  }
  const wrapper = doc.createElement('span');
  wrapper.classList.add('geld-provider-check-icon');
  wrapper.dataset.geldUi = '';
  wrapper.dataset.provider = provider;
  if (provider === 'gitlab') wrapper.classList.add(`ci-status-icon-${check.nativeStatus}`);
  wrapper.append(svg);
  return wrapper;
}
