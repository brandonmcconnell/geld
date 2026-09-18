import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * The page-world half of quick view (see `src/github/review/teleport.ts`).
 *
 * Geld's content script runs in an isolated world: it shares the DOM with
 * GitHub's React but not JavaScript objects. Two things a loaned React node
 * needs can therefore only be done from the page's own world:
 *
 * 1. When React next commits it may call `parent.insertBefore(x, loaned)` or
 *    `parent.removeChild(loaned)` on the node's original parent, which would
 *    throw and blank the nearest error boundary. While a child is on loan the
 *    parent gets instance methods that treat the placeholder as the node.
 *    Own properties set from the isolated world are invisible here, so this
 *    script sets them, told by `geld:portal-lend` / `geld:portal-return`
 *    events on the parent.
 * 2. React listens on its root container and finds the handler from the
 *    event's target. Events inside a loaned node under Geld's panel never
 *    reach that container, so a copy with the same target is dispatched
 *    there. `target` must be overridden in React's world to be seen.
 *
 * The protocol is DOM-only: the loaned node carries `data-geld-teleported=<token>`
 * and a `<!--geld:quick-view:<token>-->` comment holds its place.
 */
export default defineContentScript({
  matches: ['https://github.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // One copy per page: the background may inject this again into a tab that already has it.
    const html = document.documentElement;
    if (html.hasAttribute('data-geld-portal')) return;
    html.setAttribute('data-geld-portal', '');

    const ATTR = 'data-geld-teleported';
    const PREFIX = 'geld:quick-view:';
    const REACT_ROOT = 'react-app, react-partial, [data-react-app], [data-reactroot]';
    const BRIDGED = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress', 'input', 'change', 'focusin', 'focusout', 'submit', 'contextmenu'];

    interface Loan {
      readonly placeholder: Comment;
      readonly root: Element | null;
    }

    const loans = new Map<string, Loan>();
    const lending = new Map<Node, number>();
    /** Marks a forwarded copy so no listener — this one or a second copy of this script — forwards it again. */
    const FORWARDED = 'geldForwarded';

    function tokenOf(node: Node): string | null {
      return node instanceof Element ? node.getAttribute(ATTR) : null;
    }

    function placeholderFor(child: Node): Comment | null {
      const token = tokenOf(child);
      return token === null ? null : (loans.get(token)?.placeholder ?? null);
    }

    function shim(parent: Node): void {
      lending.set(parent, (lending.get(parent) ?? 0) + 1);
      if ((lending.get(parent) ?? 0) > 1) return;
      parent.insertBefore = function <T extends Node>(this: Node, node: T, reference: Node | null): T {
        const stand = reference !== null && reference.parentNode !== this ? placeholderFor(reference) : null;
        Node.prototype.insertBefore.call(this, node, stand ?? reference);
        return node;
      };
      parent.removeChild = function <T extends Node>(this: Node, child: T): T {
        const stand = child.parentNode === this ? null : placeholderFor(child);
        if (stand === null) Node.prototype.removeChild.call(this, child);
        else {
          stand.remove();
          if (child instanceof Element) child.remove();
        }
        return child;
      };
      parent.replaceChild = function <T extends Node>(this: Node, node: Node, child: T): T {
        const stand = child.parentNode === this ? null : placeholderFor(child);
        if (stand === null) Node.prototype.replaceChild.call(this, node, child);
        else {
          stand.replaceWith(node);
          if (child instanceof Element) child.remove();
        }
        return child;
      };
    }

    function unshim(parent: Node): void {
      const count = (lending.get(parent) ?? 1) - 1;
      if (count > 0) {
        lending.set(parent, count);
        return;
      }
      lending.delete(parent);
      Reflect.deleteProperty(parent, 'insertBefore');
      Reflect.deleteProperty(parent, 'removeChild');
      Reflect.deleteProperty(parent, 'replaceChild');
    }

    /** The React root `parent` belongs to — through the loan when `parent` itself sits inside a loaned node. */
    function rootFor(parent: Node): Element | null {
      if (!(parent instanceof Element)) return null;
      const direct = parent.closest(REACT_ROOT);
      if (direct !== null) return direct;
      const outer = parent.closest(`[${ATTR}]`);
      return outer === null ? null : (loans.get(outer.getAttribute(ATTR) ?? '')?.root ?? null);
    }

    /** Register every placeholder currently in `parent` that we have not seen. */
    function register(parent: Node): void {
      const root = rootFor(parent);
      for (const child of parent.childNodes) {
        if (!(child instanceof Comment)) continue;
        const text = child.nodeValue ?? '';
        if (!text.startsWith(PREFIX)) continue;
        const token = text.slice(PREFIX.length);
        if (!loans.has(token)) loans.set(token, { placeholder: child, root });
      }
    }

    document.addEventListener('geld:portal-lend', (event) => {
      const parent = event.target;
      if (!(parent instanceof Node)) return;
      register(parent);
      shim(parent);
    });

    document.addEventListener('geld:portal-return', (event) => {
      const parent = event.target;
      if (!(parent instanceof Node)) return;
      unshim(parent);
      for (const [token, loan] of loans) if (loan.placeholder.parentNode === null || loan.placeholder.parentNode === parent) loans.delete(token);
    });

    /** The React root a loaned ancestor of `target` came from, unless that root already contains the target. */
    function homeRootOf(target: Node): Element | null {
      let loaned = target instanceof Element ? target.closest(`[${ATTR}]`) : target.parentElement?.closest(`[${ATTR}]`) ?? null;
      while (loaned !== null) {
        const loan = loans.get(loaned.getAttribute(ATTR) ?? '');
        if (loan !== undefined && loan.root !== null) return loan.root.contains(target) ? null : loan.root;
        loaned = loaned.parentElement?.closest(`[${ATTR}]`) ?? null;
      }
      return null;
    }

    function forward(event: Event, root: Element): void {
      const copy: unknown = Reflect.construct(event.constructor, [event.type, event]);
      if (!(copy instanceof Event)) return;
      Object.defineProperty(copy, 'target', { value: event.target, configurable: true });
      Object.defineProperty(copy, FORWARDED, { value: true });
      root.dispatchEvent(copy);
      if (copy.defaultPrevented) event.preventDefault();
    }

    for (const type of BRIDGED) {
      document.addEventListener(
        type,
        (event) => {
          if (Reflect.get(event, FORWARDED) === true || !(event.target instanceof Node)) return;
          const root = homeRootOf(event.target);
          if (root !== null) forward(event, root);
        },
        true,
      );
    }
  },
});
