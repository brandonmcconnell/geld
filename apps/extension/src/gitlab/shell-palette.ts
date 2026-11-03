import { SHELL_SCOPES } from '../lib/shell-highlight';
import type { ShellScope } from '../lib/shell-highlight';

export type GitLabShellPalette = Readonly<Record<ShellScope, string>>;

const classes: Readonly<Record<ShellScope, string | null>> = {
  plain: null, keyword: 'k', built_in: 'nb', literal: 'kc', number: 'm', string: 's2',
  comment: 'c', variable: 'nv', subst: null, title: 'nf', meta: 'c', attr: 'nt',
};

export function gitLabShellSheetMedia(link: HTMLLinkElement): string {
  try { return link.sheet === null ? '' : String(link.sheet.media); } catch { return 'not all'; }
}

function activeMedia(doc: Document, value: string): boolean {
  try { return value === '' || doc.defaultView?.matchMedia(value).matches === true; } catch { return false; }
}

export function isGitLabShellThemeLink(link: HTMLLinkElement): boolean {
  try {
    const url = new URL(link.href, link.ownerDocument.URL);
    return link.relList.contains('stylesheet') && url.origin === new URL(link.ownerDocument.URL).origin && !url.username && !url.password && !url.search && !url.hash
      && /^\/assets\/highlight\/themes\/[a-z][a-z0-9_-]*-[a-f0-9]{8,64}\.css$/i.test(url.pathname);
  } catch { return false; }
}

function sheets(doc: Document): readonly CSSStyleSheet[] {
  const result: CSSStyleSheet[] = [];
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')) {
    try {
      if (!isGitLabShellThemeLink(link) || link.disabled || !activeMedia(doc, link.media) || !(link.sheet instanceof CSSStyleSheet) || link.sheet.disabled
        || link.sheet.ownerNode !== link || link.sheet.href !== link.href || !activeMedia(doc, gitLabShellSheetMedia(link))) continue;
      void link.sheet.cssRules;
      result.push(link.sheet);
    } catch { /* A blocked or unloaded native stylesheet supplies no palette. */ }
  }
  return result;
}

function styled(doc: Document, node: HTMLElement, token: string, css: readonly CSSStyleSheet[]): boolean {
  let visited = 0;
  const matches = (rules: CSSRuleList, depth: number): boolean => {
    if (depth > 8) return false;
    for (const rule of rules) {
      if (++visited > 4096) return false;
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.split(',').some((selector) => selector.includes('.code-syntax-highlight-theme')
          && new RegExp(`\\.${token}(?![\\w-])`).test(selector) && node.matches(selector))) return true;
      } else if (rule instanceof CSSMediaRule && activeMedia(doc, rule.conditionText)) {
        if (matches(rule.cssRules, depth + 1)) return true;
      } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule && CSS.supports(rule.conditionText)) {
        if (matches(rule.cssRules, depth + 1)) return true;
      }
    }
    return false;
  };
  try { return css.some((sheet) => matches(sheet.cssRules, 0)); } catch { return false; }
}

function color(doc: Document, node: Element): string | null {
  try {
    const value = doc.defaultView?.getComputedStyle(node).color ?? '';
    return value.length > 0 && value.length <= 160 && !/[;{}<>\r\n]/.test(value) && CSS.supports('color', value) ? value : null;
  } catch { return null; }
}

function codeColor(doc: Document, table: HTMLTableElement): string | null {
  try {
    const value = doc.defaultView?.getComputedStyle(table).getPropertyValue('--code-text-color').trim() ?? '';
    return value.length > 0 && value.length <= 160 && !/[;{}<>\r\n]|var\(/i.test(value) && CSS.supports('color', value) ? value : null;
  } catch { return null; }
}

export function readGitLabShellPalette(table: HTMLTableElement, nativeText: HTMLElement): GitLabShellPalette | null {
  const doc = table.ownerDocument;
  if (!table.isConnected || !table.matches('table.rd-text-view-root.code-syntax-highlight-theme')
    || !table.contains(nativeText) || nativeText.closest('[data-geld-ui]') !== null || typeof CSS === 'undefined'
    || typeof CSS.supports !== 'function' || typeof CSSStyleRule === 'undefined' || typeof CSSStyleSheet === 'undefined') return null;
  const css = sheets(doc), nativeColor = codeColor(doc, table);
  if (css.length === 0 || nativeColor === null) return null;
  const holder = doc.createElement('tbody');holder.setAttribute('data-geld-ui', '');holder.hidden = true;holder.setAttribute('aria-hidden', 'true');
  const row = doc.createElement('tr'), cell = doc.createElement('td');cell.className = 'rd-line-content';cell.style.color = nativeColor;row.append(cell);holder.append(row);
  try {
    table.append(holder);
    const foreground = color(doc, cell);if (foreground === null) return null;
    const palette: Record<ShellScope, string> = { plain: foreground, keyword: foreground, built_in: foreground, literal: foreground, number: foreground, string: foreground,
      comment: foreground, variable: foreground, subst: foreground, title: foreground, meta: foreground, attr: foreground };
    for (const scope of SHELL_SCOPES) {
      const token = classes[scope];
      if (token === null) { palette[scope] = foreground;continue; }
      const probe = doc.createElement('span');probe.className = token;probe.textContent = 'x';cell.append(probe);
      if (!styled(doc, probe, token, css)) return null;
      const value = color(doc, probe);probe.remove();if (value === null) return null;
      palette[scope] = value;
    }
    if (!table.isConnected || !table.contains(nativeText)) return null;
    return palette;
  } catch { return null; } finally { holder.remove(); }
}
