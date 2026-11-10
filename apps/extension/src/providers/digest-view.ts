import { digestViewOf } from '@geld/core';
import type { DigestView, GeldSettings } from '@geld/core';
import emblem from '../../../../assets/brand/geld-logomark-grid.svg?raw';
import gitlab from '../../public/tracker-icons/gitlab.svg?raw';
import bitbucket from '../../public/tracker-icons/bitbucket.svg?raw';
import { element } from './dom';

export function providerDigestViewChoice(provider: 'gitlab' | 'bitbucket', settings: Pick<GeldSettings, 'prOverview' | 'compactTimeline'>, choose: (view: DigestView) => Promise<void>): HTMLElement {
  const name = provider === 'gitlab' ? 'GitLab' : 'Bitbucket';
  const group = element('div', '', 'geld-provider-view');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Conversation view');
  const current = digestViewOf(settings);
  const status = element('span', '', 'geld-provider-view__status');
  status.setAttribute('role', 'status');
  const icon = (brand: 'geld' | 'provider'): Element => {
    const raw = brand === 'geld' ? emblem.replace(/fill="#000000"/, 'fill="currentColor"') : provider === 'gitlab' ? gitlab : bitbucket;
    const svg = new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'geld-provider-view__mark');
    return svg;
  };
  const options: readonly { view: DigestView; label: string; hint: string }[] = [
    { view: 'digest', label: 'Geld Digest', hint: `Geld digest with ${name} activity folded` },
    { view: 'github', label: `${name} Timeline`, hint: `${name} conversation with the digest off` },
    { view: 'digest-timeline', label: `Geld Digest + ${name} Timeline`, hint: `Geld digest and the full ${name} conversation` },
  ];
  let pending = false;
  for (const option of options) {
    const button = element('button', '', 'geld-provider-view__option');
    button.type = 'button';
    button.dataset.geldDigestView = option.view;
    button.setAttribute('aria-label', option.label);
    button.setAttribute('aria-pressed', String(option.view === current));
    button.title = option.hint;
    button.append(icon(option.view === 'github' ? 'provider' : 'geld'));
    if (option.view === 'digest-timeline') button.append(element('span', '+'), icon('provider'));
    else button.append(element('span', option.view === 'digest' ? 'Digest' : 'Timeline'));
    button.addEventListener('click', () => {
      if (pending || !group.isConnected) return;
      pending = true;
      group.setAttribute('aria-busy', 'true');
      const saved = choose(option.view);
      for (const control of group.querySelectorAll('button')) control.disabled = true;
      status.textContent = '';
      void saved.then(() => { const menu = group.closest('details');if (menu !== null) menu.open = false; }).catch(() => { status.textContent = 'The view could not be saved. Try again.'; }).finally(() => {
        pending = false;
        group.removeAttribute('aria-busy');
        for (const control of group.querySelectorAll('button')) control.disabled = false;
      });
    });
    group.append(button);
  }
  group.append(status);
  return group;
}
