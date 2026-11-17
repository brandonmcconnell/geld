import { moveNode } from '../github/review/teleport';

/**
 * The host's own CI section shown in the CI row while the row is open, as GitHub's checks section is (its merge box's
 * list lent to the row): moved, never cloned, so its stage menus, links and live polling stay the host's own.
 *
 * What is lent is the section's first child, not the section: a framework that inserts a sibling before a node uses
 * that node as its anchor, and a node away from its parent would make the insertion throw. Anything the framework
 * puts where the lent node now stands (it inserts a replacement beside the node it replaces, wherever that is) lands
 * in the holder, and goes home with it. A placeholder comment keeps the place; a home that went while the node was
 * away takes nothing back (the framework has let go of it), and the holder is emptied.
 */
export class NativeChecksLoan {
  private loan: { readonly holder: HTMLElement; readonly placeholder: Comment; readonly home: Node; readonly watch: MutationObserver } | null = null;

  constructor(private readonly changed: () => void) {}

  /** Lend `native` into `slot`, or keep the loan where it is; null sends it home. */
  sync(slot: HTMLElement | null, native: HTMLElement | null): void {
    if (slot === null || native === null || !slot.isConnected) {
      this.return();
      return;
    }
    const current = this.loan;
    if (current !== null && current.holder.contains(native)) {
      if (current.holder.parentElement !== slot) moveNode(slot, current.holder);
      return;
    }
    this.return();
    const home = native.parentNode;
    if (home === null) return;
    const doc = slot.ownerDocument;
    const placeholder = doc.createComment('geld:native-checks');
    home.insertBefore(placeholder, native);
    const holder = doc.createElement('div');
    holder.className = 'geld-provider-review__native-checks';
    holder.dataset.geldNativeChecks = '';
    slot.append(holder);
    moveNode(holder, native);
    // The framework rebuilt the section at home (a new pipeline): the loan is stale, so the row lends afresh.
    const watch = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((added) => added instanceof Element))) this.changed();
    });
    watch.observe(home, { childList: true });
    this.loan = { holder, placeholder, home, watch };
  }

  /** Whether the row is showing the host's own section now. */
  get lent(): boolean {
    return this.loan !== null;
  }

  return(): void {
    const loan = this.loan;
    if (loan === null) return;
    this.loan = null;
    loan.watch.disconnect();
    const { holder, placeholder } = loan;
    const parent = placeholder.parentNode;
    if (parent !== null && placeholder.isConnected) for (const child of [...holder.childNodes]) moveNode(parent, child, placeholder);
    else holder.replaceChildren();
    placeholder.remove();
    holder.remove();
  }
}
