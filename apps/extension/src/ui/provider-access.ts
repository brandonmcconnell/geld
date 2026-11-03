import { enableProviderAccess, hasProviderAccess } from '../lib/provider-access';
import type { OptionalProvider } from '../lib/provider-access-spec';

export function mountProviderAccess(host: HTMLElement, enabled: () => void = () => undefined): void {
  const title = document.createElement('p');
  title.className = 'geld-eyebrow'; title.textContent = 'Additional sites';
  const help = document.createElement('p');
  help.className = 'geld-help'; help.textContent = 'Choose which sites Geld can access. GitHub stays enabled.';
  const row = document.createElement('div'); row.className = 'geld-row';
  const status = document.createElement('p'); status.className = 'geld-status'; status.setAttribute('role', 'status');
  for (const provider of ['gitlab', 'bitbucket'] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'geld-button geld-button--small'; button.dataset.providerEnable = provider;
    const label = provider === 'gitlab' ? 'GitLab' : 'Bitbucket';
    const render = (granted: boolean): void => { button.textContent = granted ? `${label} enabled` : `Enable ${label}`; button.disabled = granted; };
    let revision = 0;
    render(false);
    void hasProviderAccess(provider).then((granted) => { if (revision === 0) render(granted); });
    button.addEventListener('click', () => { void request(provider); });
    async function request(value: OptionalProvider): Promise<void> {
      revision += 1; button.disabled = true; button.setAttribute('aria-busy', 'true');
      try {
        const granted = await enableProviderAccess(value);
        render(granted); status.textContent = granted ? `${label} enabled. Reload open ${label} tabs.` : `${label} access was not granted.`;
        if (granted) enabled();
      } catch { render(false); status.textContent = `${label} access could not be enabled.`; }
      finally { button.removeAttribute('aria-busy'); }
    }
    row.append(button);
  }
  host.append(title, help, row, status);
}
