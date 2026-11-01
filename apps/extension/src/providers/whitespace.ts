import type { GeldSettings } from '@geld/core';
import { compileRepoRules, decideRepo, describeRepository, providerRepositoryScope } from '@geld/core';

const MAX_OPT_OUTS = 400;
const LOOP_WINDOW_MS = 4000;
const UNSUPPORTED_MS = 60_000;

interface RedirectMemory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface WhitespaceEnvironment {
  readonly memory?: RedirectMemory;
  readonly now?: () => number;
  readonly navigationStart?: () => number;
}

export function mergeWhitespaceOptOuts(base: Readonly<Record<string, number>>, edited: Readonly<Record<string, number>>, latest: Readonly<Record<string, number>>): Record<string, number> {
  const merged = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(edited)])) {
    if (base[key] === edited[key]) continue;
    const value = edited[key];
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return Object.fromEntries(Object.entries(merged).filter(([, at]) => Number.isFinite(at)).sort((a, b) => b[1] - a[1]).slice(0, MAX_OPT_OUTS));
}

function diffPage(url: URL): boolean {
  return url.hostname === 'gitlab.com' && !url.searchParams.has('format') && (
    /\/-\/merge_requests\/[1-9]\d*\/diffs\/?$/.test(url.pathname)
    || /\/-\/commit\/[0-9a-f]{7,64}\/?$/i.test(url.pathname)
    || /\/-\/compare\/[^/]+$/.test(url.pathname)
  );
}

function visitKey(url: URL): string {
  return JSON.stringify(['gitlab', url.origin, url.pathname.replace(/\/$/, '')]);
}

export class ProviderWhitespace {
  private settings: GeldSettings;
  private optOuts: Record<string, number>;
  private readonly handled = new Set<string>();

  constructor(settings: GeldSettings, optOuts: Readonly<Record<string, number>>, private readonly save: (value: Readonly<Record<string, number>>) => void, private readonly environment: WhitespaceEnvironment = {}) {
    this.settings = settings;
    this.optOuts = Object.fromEntries(Object.entries(optOuts).filter(([, at]) => Number.isFinite(at)));
  }

  update(settings: GeldSettings): void { this.settings = settings; }

  navigation(url: URL): string | null {
    if (!this.allowed(url)) return null;
    const key = visitKey(url);
    if (url.searchParams.get('w') === '1') {
      if (this.optOuts[key] !== undefined) {
        delete this.optOuts[key];
        this.save({ ...this.optOuts });
      }
      return null;
    }
    if (url.searchParams.get('w') === '0') {
      if (this.optOuts[key] === undefined) {
        this.optOuts[key] = this.now();
        this.optOuts = Object.fromEntries(Object.entries(this.optOuts).sort((a, b) => b[1] - a[1]).slice(0, MAX_OPT_OUTS));
        this.save({ ...this.optOuts });
      }
      return null;
    }
    const result = this.link(url);
    if (result === url.href || this.handled.has(key) || this.redirectStripped(key)) return null;
    this.handled.add(key);
    this.remember(key, String(this.now()));
    return result;
  }

  private now(): number { return this.environment.now?.() ?? Date.now(); }

  private memory(): RedirectMemory | undefined {
    try { return this.environment.memory ?? globalThis.sessionStorage; } catch { return undefined; }
  }

  private remember(key: string, value: string): void {
    try { this.memory()?.setItem(`geld:provider-whitespace:${key}`, value); } catch { /* Session storage can be disabled. */ }
  }

  private redirectStripped(key: string): boolean {
    let previous: string | null = null;
    try { previous = this.memory()?.getItem(`geld:provider-whitespace:${key}`) ?? null; } catch { return false; }
    if (previous === null) return false;
    if (previous.startsWith('unsupported:')) return this.now() - Number(previous.slice(12)) < UNSUPPORTED_MS;
    const at = Number(previous);
    const started = this.environment.navigationStart?.() ?? globalThis.performance?.timeOrigin ?? this.now();
    if (!Number.isFinite(at) || at <= 0 || started < at || started - at >= LOOP_WINDOW_MS) return false;
    this.remember(key, `unsupported:${this.now()}`);
    return true;
  }

  link(url: URL): string {
    if (!this.allowed(url) || url.searchParams.has('w') || this.optOuts[visitKey(url)] !== undefined) return url.href;
    const rewritten = new URL(url);
    rewritten.searchParams.set('w', '1');
    return rewritten.href;
  }

  private allowed(url: URL): boolean {
    if (!this.settings.enabled || !this.settings.hideWhitespace || !diffPage(url)) return false;
    const repository = describeRepository(url);
    return repository !== null && decideRepo(compileRepoRules(this.settings.repoRules), providerRepositoryScope(repository)).allowed;
  }
}
