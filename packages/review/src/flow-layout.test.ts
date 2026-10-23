import { describe, expect, it } from 'vitest';
import { layoutFlow } from './flow-layout';
import type { FlowEdge, FlowNode } from './review-plan';

const node = (id: string, label = id): FlowNode => ({ id, label, file: null, kind: 'changed', step: null });
const edge = (from: string, to: string, label: string | null = null): FlowEdge => ({ from, to, label });

describe('layoutFlow', () => {
  it('layers by longest path and keeps a decision\u2019s branches in its row order', () => {
    // report → deliveries → matching? → (yes) delivered? → (yes) existing, (no) new; matching? → (no) report back.
    const nodes = [node('report'), node('deliveries'), node('matching'), node('delivered'), node('existing'), node('fresh'), node('back')];
    const edges = [edge('report', 'deliveries'), edge('deliveries', 'matching'), edge('matching', 'delivered', 'yes'), edge('matching', 'back', 'no'), edge('delivered', 'existing', 'yes'), edge('delivered', 'fresh', 'no')];
    const layout = layoutFlow(nodes, edges);
    const at = (id: string): readonly [number, number] => {
      const placed = layout.placed.find((entry) => entry.node.id === id);
      return placed === undefined ? [-1, -1] : [placed.layer, placed.row];
    };
    expect(at('report')).toEqual([0, 0]);
    expect(at('deliveries')).toEqual([1, 0]);
    expect(at('matching')).toEqual([2, 0]);
    expect(at('delivered')[0]).toBe(3);
    expect(at('back')[0]).toBe(3);
    expect(at('existing')[0]).toBe(4);
    expect(at('fresh')[0]).toBe(4);
    expect(layout.layers).toBe(5);
    expect(layout.rows).toBe(2);
    expect(layout.edges).toHaveLength(6);
  });

  it('drops edges to unknown nodes and self loops, and survives a cycle', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('b', 'b'), edge('a', 'zzz')];
    const layout = layoutFlow(nodes, edges);
    expect(layout.edges).toHaveLength(3);
    expect(layout.layers).toBeGreaterThanOrEqual(1);
    expect(layout.placed.map((placed) => placed.node.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders a layer by the mean row of what points at it', () => {
    const nodes = [node('top'), node('bottom'), node('x'), node('y')];
    // `y` is fed by `top`, `x` by `bottom`: y sits above x although it is listed after.
    const layout = layoutFlow(nodes, [edge('top', 'y'), edge('bottom', 'x')]);
    const rowOf = (id: string): number => layout.placed.find((placed) => placed.node.id === id)?.row ?? -1;
    expect(rowOf('y')).toBe(0);
    expect(rowOf('x')).toBe(1);
  });

  it('is empty for nothing', () => {
    expect(layoutFlow([], [])).toEqual({ placed: [], edges: [], layers: 0, rows: 0 });
  });
});
