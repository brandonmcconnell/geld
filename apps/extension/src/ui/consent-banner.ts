import { consentPatch } from '@geld/core';
import type { ConsentChoice, GeldSettings } from '@geld/core';
import { settingsItem } from '../lib/storage';

/**
 * The extension's privacy prompt, in the popup and on the options page until the reader answers it: the same choices
 * as the dashboard's consent banner (c15t there, "Your work. Your choices."), kept as settings here so the answer syncs
 * with the rest of them. It covers what the extension can send to geld.sh: anonymous usage statistics and error reports.
 * Firefox builds send neither (its data-collection permission is not asked for yet), so they never show it.
 */

export const CONSENT_COPY = {
  title: 'Your work. Your choices.',
  body: 'Geld can send geld.sh anonymous counts of how its features are used and reports of its own errors, which geld.sh forwards to PostHog. Neither names a page, repository, file or person. Usage counts are on until you choose, and error reports stay off unless you opt in.',
  all: 'Opt in to all',
  necessary: 'Necessary only',
  manage: 'Manage',
  save: 'Save choices',
  usage: { label: 'Usage statistics', help: 'How often Geld’s features are used, with no identifier, once a day.' },
  errors: { label: 'Error reports', help: 'What broke and where in Geld’s code, with an AI provider’s refusal in its own words.' },
  gpc: 'Your browser asks sites not to track you (Global Privacy Control), so Geld sends nothing optional.',
} as const;

/** The browser's Global Privacy Control, which Firefox, Brave and some extensions turn on: honoured as a refusal. */
function globalPrivacyRefused(): boolean {
  return typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true;
}

export function consentPending(settings: GeldSettings): boolean {
  return settings.consentDecidedAt === '' && !import.meta.env.FIREFOX;
}

/** A choice as the browser lets it stand: with Global Privacy Control on, nothing optional is sent whatever was ticked. */
export function honoured(choice: ConsentChoice): ConsentChoice {
  return globalPrivacyRefused() ? { usageStats: false, errorReports: false } : choice;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', children: ReadonlyArray<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function button(text: string, modifier: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `geld-button geld-button--small${modifier === '' ? '' : ` ${modifier}`}`, [text]);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function option(id: string, copy: { readonly label: string; readonly help: string }, checked: boolean, disabled: boolean): { readonly row: HTMLLabelElement; readonly input: HTMLInputElement } {
  const input = el('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.disabled = disabled;
  const row = el('label', 'geld-consent__option', [input, el('span', 'geld-consent__option-text', [el('span', 'geld-label', [copy.label]), el('span', 'geld-help', [copy.help])])]);
  return { row, input };
}

/** Shows the prompt in `host` while it waits for an answer, and takes it away once one is given here or anywhere else. */
export function mountConsentBanner(host: HTMLElement, initial: GeldSettings): void {
  let managing = false;
  const decide = async (choice: ConsentChoice): Promise<void> => {
    await settingsItem.patch(consentPatch(honoured(choice), new Date().toISOString()));
  };
  const render = (settings: GeldSettings): void => {
    host.replaceChildren();
    if (!consentPending(settings)) return;
    const refused = globalPrivacyRefused();
    const alert = el('section', 'geld-alert geld-alert--notice geld-consent', [el('p', 'geld-alert__title', [CONSENT_COPY.title]), el('p', 'geld-alert__text', [CONSENT_COPY.body])]);
    alert.setAttribute('aria-label', 'Privacy choices');
    if (refused) alert.append(el('p', 'geld-help geld-consent__gpc', [CONSENT_COPY.gpc]));
    if (managing) {
      const usage = option('consent-usage', CONSENT_COPY.usage, settings.usageStats && !refused, refused);
      const errors = option('consent-errors', CONSENT_COPY.errors, settings.errorReports && !refused, refused);
      alert.append(
        el('div', 'geld-consent__options', [usage.row, errors.row]),
        el('div', 'geld-alert__actions', [button(CONSENT_COPY.save, 'geld-button--primary', () => void decide({ usageStats: usage.input.checked, errorReports: errors.input.checked }))]),
      );
    } else {
      alert.append(
        el('div', 'geld-alert__actions', [
          button(CONSENT_COPY.all, 'geld-button--primary', () => void decide({ usageStats: true, errorReports: true })),
          button(CONSENT_COPY.necessary, '', () => void decide({ usageStats: false, errorReports: false })),
          button(CONSENT_COPY.manage, '', () => {
            managing = true;
            render(settings);
          }),
        ]),
      );
    }
    host.append(alert);
  };
  render(initial);
  settingsItem.watch((next) => render(next));
}
