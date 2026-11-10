import type { ProviderStatusAction } from './types';

export class ProviderStatusControls {
  private current: ProviderStatusAction | null = null;
  private button: HTMLButtonElement | null = null;
  private display = '';
  private priority = '';
  private marker: string | null = null;

  update(action: ProviderStatusAction | null): void {
    if (action === null) { this.clear();return; }
    if (this.current?.label !== action.label || this.current.control !== action.control || this.current.key !== action.key || this.button?.isConnected !== true) {
      this.clear();this.current = action;
      const label = action.label;
      this.display = label.style.getPropertyValue('display');this.priority = label.style.getPropertyPriority('display');
      this.marker = label.getAttribute('data-geld-status-replaced');
      const button = label.ownerDocument.createElement('button');button.type = 'button';
      button.dataset.geldUi = '';button.className = `${label.className} geld-provider-status`;
      for (const child of label.childNodes) button.append(child.cloneNode(true));
      const caret = label.ownerDocument.createElement('span');caret.className = 'geld-provider-status__caret';caret.textContent = '▾';caret.setAttribute('aria-hidden', 'true');button.append(caret);
      button.setAttribute('aria-label', `${label.textContent?.trim() ?? 'Status'}. Open request actions`);
      button.setAttribute('aria-haspopup', 'menu');
      button.addEventListener('click', () => {
        const current = this.current;
        if (current === null || this.button !== button || !button.isConnected) return;
        void current.activate().then(opened => {
          if (this.current !== current || this.button !== button || !button.isConnected) return;
          this.refreshExpanded(current);
          if (!opened) button.title = 'Request actions are unavailable';
          else button.removeAttribute('title');
        }).catch(() => { if (this.current === current && button.isConnected) button.title = 'Request actions are unavailable'; });
      });
      label.after(button);label.dataset.geldStatusReplaced = '';label.style.setProperty('display', 'none', 'important');
      this.button = button;
    }
    this.current = action;
    this.refreshExpanded(action);
  }

  private refreshExpanded(action: ProviderStatusAction): void {
    const expanded = action.control.getAttribute('aria-expanded') ?? 'false';
    if (this.button?.getAttribute('aria-expanded') !== expanded) this.button?.setAttribute('aria-expanded', expanded);
  }

  clear(): void {
    if (this.current !== null) {
      const label = this.current.label;
      if (label.style.getPropertyValue('display') === 'none' && label.style.getPropertyPriority('display') === 'important') {
        if (this.display === '') label.style.removeProperty('display');
        else label.style.setProperty('display', this.display, this.priority);
      }
      if (label.getAttribute('data-geld-status-replaced') === '') {
        if (this.marker === null) label.removeAttribute('data-geld-status-replaced');
        else label.setAttribute('data-geld-status-replaced', this.marker);
      }
    }
    this.button?.remove();this.button = null;this.current = null;
  }
}
