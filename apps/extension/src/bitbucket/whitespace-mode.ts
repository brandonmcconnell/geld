import { compileRepoRules, decideRepo, providerRepositoryScope } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import type { ProviderPage, ProviderPageMode } from '../providers/types';
import { describeBitbucketProviderPage } from './page';
import { WHITESPACE_READY, WHITESPACE_REQUEST, WHITESPACE_RESPONSE } from './whitespace-main';

interface Receipt { readonly route: string; readonly comparison: string; readonly status: 'legacy' | 'pending' | 'ready'; readonly value: boolean | null; readonly epoch: number }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function route(doc: Document): string | null {
  const url = new URL(doc.URL);
  return url.origin === 'https://bitbucket.org' && !url.search && /^\/[^/]+\/[^/]+\/pull-requests\/[1-9]\d*\/diff\/?$/.test(url.pathname) ? url.origin + url.pathname : null;
}

export function createBitbucketWhitespaceMode(doc: Document, changed: () => void): ProviderPageMode {
  const host = doc.defaultView;
  const id = crypto.randomUUID();let settings: GeldSettings | null = null, receipt: Receipt | null = null, stopped = false, requestKey = '', startedAt = 0, active = false, startupExpired = false;
  const request = (active: boolean, hide: boolean): void => { doc.dispatchEvent(new CustomEvent(WHITESPACE_REQUEST, { detail: JSON.stringify({ id, active, hide }) })); };
  const allowed = (page: ProviderPage): boolean => settings !== null && settings.enabled && decideRepo(compileRepoRules(settings.repoRules), providerRepositoryScope(page.repository)).allowed;
  const sync = (): void => {
    const subject = describeBitbucketProviderPage(new URL(doc.URL));
    const url = route(doc), nextActive = !stopped && url !== null && settings !== null && settings.enabled && subject !== null && allowed(subject);
    const key = JSON.stringify([url, nextActive, settings?.hideWhitespace ?? false]);
    if (key === requestKey) return;
    requestKey = key;receipt = null;active = nextActive;startedAt = Date.now();startupExpired = false;request(active, settings?.hideWhitespace ?? false);
  };
  const response = (event: Event): void => {
    if (stopped || !(event instanceof CustomEvent) || typeof event.detail !== 'string' || event.detail.length > 1024) return;
    try {
      const value: unknown = JSON.parse(event.detail);
      if (!object(value) || typeof value.route !== 'string' || value.id !== id || value.route !== route(doc) || typeof value.comparison !== 'string' || value.comparison.length > 500
        || !['legacy', 'pending', 'ready'].includes(String(value.status)) || !Number.isSafeInteger(value.epoch) || typeof value.epoch !== 'number' || value.epoch < 0
        || !(typeof value.value === 'boolean' || value.value === null) || value.status === 'ready' && (typeof value.value !== 'boolean' || value.comparison === '')) return;
      const next: Receipt = { route: value.route, comparison: value.comparison, status: value.status === 'ready' ? 'ready' : value.status === 'pending' ? 'pending' : 'legacy', value: value.value, epoch: value.epoch };
      if (receipt !== null && next.epoch < receipt.epoch) return;
      if (JSON.stringify(receipt) === JSON.stringify(next)) return;receipt = next;changed();
    } catch { /* Only the fixed native receipt shape is accepted. */ }
  };
  const ready = (): void => { if (stopped) return;receipt = null;request(active, settings?.hideWhitespace ?? false);changed(); };
  doc.addEventListener(WHITESPACE_READY, ready);
  doc.addEventListener(WHITESPACE_RESPONSE, response);
  const timer = host?.setInterval(() => {
    if (stopped || settings === null) return;
    sync();
    if (receipt === null) request(active, settings.hideWhitespace);
    if (!startupExpired && Date.now() - startedAt >= 5_000) { startupExpired = true;changed(); }
  }, 1000);
  return {
    update(value) { settings = value;sync(); },
    decorate(page) {
      sync();
      const state = receipt;
      if (page === null || page.provider !== 'bitbucket' || page.kind !== 'diff' || !allowed(page) || state?.status === 'legacy' || state !== null && state.route !== route(doc)
        || new URL(page.url).pathname.replace(/\/$/, '') + '/diff' !== new URL(doc.URL).pathname.replace(/\/$/, '')) return page;
      if (state === null || state.status === 'pending') {
        if (state === null && (!active || startupExpired)) return page;
        return { ...page, version: `${page.version}|native-whitespace:pending`, diffMode: { ignoreWhitespace: null, current: () => false } };
      }
      if (settings?.hideWhitespace === false && state.value === false) return page;
      let comparison: unknown;try { comparison = JSON.parse(state.comparison); } catch { return page; }
      if (!Array.isArray(comparison) || comparison.length !== 5 || comparison[0] !== page.repository.path || comparison[1] !== page.number || typeof comparison[2] !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(comparison[2])
        || typeof comparison[3] !== 'string' || !/^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/.test(comparison[3]) || typeof comparison[4] !== 'string' || !/^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/.test(comparison[4])) return page;
      const head = comparison[3], base = comparison[4], sourceRepository = comparison[2];
      const current = (): boolean => !stopped && receipt === state && route(doc) === state.route && state.status === 'ready';
      return { ...page, headSha: head.length === 40 || head.length === 64 ? head : page.headSha, version: `${page.version}|native-whitespace:${state.comparison}:${state.value ?? 'pending'}`, diffMode: { comparison: { head, base, sourceRepository }, ignoreWhitespace: state.value, current } };
    },
    stop() { if (stopped) return;stopped = true;request(false, false);doc.removeEventListener(WHITESPACE_READY, ready);doc.removeEventListener(WHITESPACE_RESPONSE, response);if (timer !== undefined) host?.clearInterval(timer); },
  };
}
