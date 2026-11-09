// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveNode, restoreAll, teleportInto } from './teleport';

afterEach(() => {
  restoreAll();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function timeline(): { readonly home: HTMLElement; readonly node: HTMLElement; readonly after: HTMLElement; readonly slot: HTMLElement } {
  const home = document.createElement('div');
  const node = document.createElement('div');
  node.id = 'discussion_r1';
  const after = document.createElement('div');
  home.append(node, after);
  const slot = document.createElement('div');
  document.body.append(home, slot);
  return { home, node, after, slot };
}

describe('loans move rather than reinsert', () => {
  it('lends with the browser’s move and sends the node back to its place the same way', () => {
    const { home, node, after, slot } = timeline();
    const moves: Node[] = [];
    // happy-dom has no `moveBefore`: stand in for Chrome's, recording what it moved where.
    const mover = function (this: Node, moving: Node, before: Node | null): void {
      moves.push(this);
      this.insertBefore(moving, before);
    };
    Object.defineProperty(Element.prototype, 'moveBefore', { value: mover, configurable: true });
    try {
      teleportInto(slot, [node]);
      expect(node.parentElement).toBe(slot);
      expect(home.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
      restoreAll();
      expect([...home.childNodes]).toEqual([node, after]);
      expect(moves).toEqual([slot, home]);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'moveBefore');
    }
  });

  it('falls back to a plain insertion where the browser has no move, or the slot is not in the document', () => {
    const { home, node, after, slot } = timeline();
    teleportInto(slot, [node]);
    expect(node.parentElement).toBe(slot);
    restoreAll();
    expect([...home.childNodes]).toEqual([node, after]);

    const detached = document.createElement('div');
    const mover = vi.fn();
    Object.defineProperty(Element.prototype, 'moveBefore', { value: mover, configurable: true });
    try {
      moveNode(detached, node);
      expect(mover).not.toHaveBeenCalled();
      expect(node.parentElement).toBe(detached);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'moveBefore');
    }
  });
});
