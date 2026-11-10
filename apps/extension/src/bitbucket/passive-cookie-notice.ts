const LABEL = 'cookiesTrackingNoticeLink';
const COOKIE = `[aria-labelledby="${LABEL}"]`;
const ROOT = 'unsafe-design-system-page-layout-root';
const LAYOUT_STYLE = /^\s*#unsafe-design-system-page-layout-root\s*\{\s*--n_bnrM:\s*(\d{1,4}(?:\.\d{1,3})?)px\s*;?\s*\}\s*$/;
const EXCLUDED = '[data-geld-ui],form,textarea,input,select,[contenteditable],.ak-renderer-document,.md,[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"]';
const FIELDS = 'form,input,textarea,select,[contenteditable],[role="textbox"],[role="checkbox"],[role="switch"],dialog,[role="dialog"]';
const TAGS = new Set(['DIV', 'SPAN', 'A', 'BUTTON', 'SVG', 'PATH']);
const ATTRIBUTES = new Set(['class', 'style', 'id', 'role', 'aria-labelledby', 'aria-hidden', 'aria-live', 'href', 'target', 'type', 'data-testid', 'fill', 'viewbox', 'd']);
const BUTTONS = [['preferences-button', 'Preferences'], ['only-necessary-button', 'Only necessary'], ['accept-all-button', 'Accept all']];

interface Owner { readonly root: Element; readonly slot: Element; readonly parent: Element }
interface Notice extends Owner {
  readonly dialog: Element;
  readonly nodes: readonly Node[];
  readonly signature: string;
}
interface CookieHistory { readonly neutral: ReadonlySet<Element>; readonly invalid: boolean }

function nodesOf(node: Element): readonly Node[] | null {
  const nodes: Node[] = [node];const walker = node.ownerDocument.createTreeWalker(node);
  for (let next = walker.nextNode(); next !== null; next = walker.nextNode()) { if (nodes.length >= 100) return null;nodes.push(next); }
  return nodes;
}
function safe(node: Element): boolean { return node.closest(EXCLUDED) === null; }
function signature(nodes: readonly Node[], dialog: Element): string {
  return JSON.stringify(nodes.map((node) => node.nodeType === 3 ? node.textContent : node instanceof node.ownerDocument!.defaultView!.Element
    ? [node.tagName, [...node.attributes].filter((a) => a.name !== 'class' && a.name !== 'style' && !(node === dialog && a.name === 'role')).map((a) => [a.name, a.value])] : null));
}

/** Neutral only to initial local-render history; never remove these dialogs from Settings qualification. */
export class BitbucketPassiveCookieNotice {
  private root: Element | null = null;
  private readonly known = new Map<Element, Notice>();

  constructor(private readonly doc: Document) {}

  private layoutStyle(node: Node): boolean {
    const view = this.doc.defaultView;
    if (view === null || !(node instanceof view.Element) || node.tagName !== 'STYLE' || node.attributes.length !== 0 || ![...node.childNodes].every((child) => child.nodeType === 3)) return false;
    const text = node.textContent ?? '';const value = text.length <= 256 ? LAYOUT_STYLE.exec(text)?.[1] : undefined;
    return value !== undefined && Number(value) <= 4096;
  }

  private owner(dialog: Element, records: readonly MutationRecord[]): Owner | null {
    const roots = this.doc.querySelectorAll(`#${ROOT}`);const root = roots[0];
    if (roots.length !== 1 || root === undefined || !root.isConnected || !safe(root) || this.root !== null && root !== this.root) return null;
    const candidates = new Set<Element>();if (dialog.parentElement !== null) candidates.add(dialog.parentElement);
    for (const record of records) {
      if (record.type !== 'childList' || !(record.target instanceof this.doc.defaultView!.Element)) continue;
      if ([...record.addedNodes, ...record.removedNodes].includes(dialog)) candidates.add(record.target);
    }
    for (const parent of candidates) {
      if (parent.tagName !== 'DIV' || !safe(parent) || parent.closest('dialog,[role="dialog"]') !== null || [...parent.attributes].some((a) => !['class', 'style'].includes(a.name))
        || [...parent.childNodes].some((n) => n !== dialog && (n.nodeType !== 3 || n.textContent?.trim() !== ''))) continue;
      const slots = new Set<Element>();if (parent.parentElement !== null) slots.add(parent.parentElement);
      for (const record of records) if (record.type === 'childList' && record.target instanceof this.doc.defaultView!.Element && [...record.addedNodes, ...record.removedNodes].includes(parent)) slots.add(record.target);
      for (const slot of slots) {
        if (slot.tagName !== 'DIV' || slot.getAttribute('data-layout-slot') !== 'true' || !safe(slot) || [...slot.childNodes].filter((n) => this.layoutStyle(n)).length > 1
          || [...slot.childNodes].some((n) => n !== parent && !this.layoutStyle(n) && (n.nodeType !== 3 || n.textContent?.trim() !== ''))) continue;
        const current = slot.parentElement === root;
        const removed = records.some((r) => r.type === 'childList' && r.target === root && [...r.addedNodes, ...r.removedNodes].includes(slot));
        if (current || removed) return { root, slot, parent };
      }
    }
    return null;
  }

  private recognize(dialog: Element, records: readonly MutationRecord[]): Notice | null {
    const view = this.doc.defaultView;if (view === null || dialog.ownerDocument !== this.doc || dialog.tagName !== 'DIV' || !safe(dialog) || dialog.getAttribute('aria-labelledby') !== LABEL) return null;
    const known = this.known.get(dialog);const role = dialog.getAttribute('role');
    if (role !== 'dialog' && !(role === null && (known !== undefined || records.some((r) => r.target === dialog && r.attributeName === 'role' && r.oldValue === 'dialog')))) return null;
    const owner = this.owner(dialog, records);if (owner === null || dialog.querySelector(FIELDS) !== null || dialog.querySelector(EXCLUDED) !== null) return null;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];const links = [...dialog.querySelectorAll<HTMLAnchorElement>('a')];
    if (buttons.length !== 3 || links.length !== 2 || buttons.some((b, i) => b.type !== 'button' || b.disabled || b.getAttribute('aria-live') !== 'polite' || b.getAttribute('data-testid') !== BUTTONS[i]?.[0] || b.textContent?.trim() !== BUTTONS[i]?.[1])
      || links.some((a) => a.id !== LABEL || a.getAttribute('href') !== 'https://www.atlassian.com/legal/cookies' || a.getAttribute('target') !== '_blank' || !a.textContent?.startsWith('Atlassian cookies and tracking notice'))
      || dialog.querySelectorAll(`[id="${LABEL}"]`).length !== 2) return null;
    const nodes = nodesOf(dialog);
    if (nodes === null || nodes.some((node) => node.nodeType !== 3 && (!(node instanceof view.Element) || !TAGS.has(node.tagName.toUpperCase())
      || node !== dialog && node.getAttribute('role') !== null && node.getAttribute('role') !== 'presentation' || [...node.attributes].some((a) => !ATTRIBUTES.has(a.name.toLowerCase()))))) return null;
    const value = signature(nodes, dialog);
    if (known !== undefined && (owner.root !== known.root || owner.slot !== known.slot || owner.parent !== known.parent || nodes.length !== known.nodes.length || nodes.some((n, i) => n !== known.nodes[i]) || value !== known.signature)) return null;
    const notice = known ?? { ...owner, dialog, nodes, signature: value };this.root = owner.root;
    if (this.known.size >= 4 && !this.known.has(dialog)) return null;
    this.known.set(dialog, notice);return notice;
  }

  current(dialog: Element): boolean {
    const notices = [...this.doc.querySelectorAll(COOKIE)].filter(safe);
    return notices.length === 1 && notices[0] === dialog && dialog.isConnected && this.recognize(dialog, []) !== null;
  }

  unknownCurrent(): boolean { return [...this.doc.querySelectorAll(COOKIE)].filter(safe).some((notice) => !this.current(notice)); }

  history(records: readonly MutationRecord[]): CookieHistory {
    const view = this.doc.defaultView;if (view === null) return { neutral: new Set(), invalid: true };
    const candidates = new Set<Element>([...this.doc.querySelectorAll(COOKIE)].filter(safe));
    for (const record of records) {
      if (!(record.target instanceof view.Element) || !safe(record.target)) continue;
      const closest = record.target.closest(COOKIE);if (closest !== null) candidates.add(closest);
      if (this.known.has(record.target)) candidates.add(record.target);
      for (const node of [...record.addedNodes, ...record.removedNodes]) if (node instanceof view.Element && safe(node)) {
        if (node.matches(COOKIE)) candidates.add(node);for (const n of node.querySelectorAll(COOKIE)) candidates.add(n);
      }
    }
    const neutral = new Set<Element>();let invalid = false;
    if (candidates.size > 1) return { neutral, invalid: true };
    for (const dialog of candidates) {
      const prior = this.known.get(dialog);const notice = this.recognize(dialog, records);if (notice === null) { invalid = true;continue; }
      neutral.add(dialog);
      for (const record of records) {
        const target = record.target;if (!(target instanceof view.Element) && target.nodeType !== 3) continue;
        const inside = notice.nodes.includes(target) || prior?.nodes.includes(target) === true || dialog.contains(target);
        if (inside) {
          if (record.type === 'attributes' && ['class', 'style'].includes(record.attributeName ?? '')) continue;
          if (target === dialog && record.type === 'attributes' && record.attributeName === 'role' && [null, 'dialog'].includes(record.oldValue) && [null, 'dialog'].includes(dialog.getAttribute('role')) && (prior !== undefined || record.oldValue === 'dialog')) continue;
          if (record.type === 'attributes' && record.attributeName === 'aria-labelledby' && target === dialog && record.oldValue === LABEL && dialog.getAttribute('aria-labelledby') === LABEL) continue;
          invalid = true;
        } else if ([notice.slot, notice.parent].some((node) => node === target)) {
          if (record.type === 'attributes' && ['class', 'style'].includes(record.attributeName ?? '')) continue;
          if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((n) => n === notice.slot || n === notice.parent || n === dialog || this.layoutStyle(n))) continue;
          invalid = true;
        } else if (target === notice.root) {
          if (record.type === 'attributes' && record.attributeName === 'id') invalid = true;
        } else if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some((n) => n === notice.root || n.contains(notice.root) || n === notice.slot)) {
          invalid = true;
        }
      }
    }
    return { neutral, invalid };
  }
}
