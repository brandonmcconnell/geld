/**
 * Where each box of a flow goes: layers left to right by longest path from
 * the sources, rows within a layer ordered by the mean row of their
 * predecessors (one barycentre pass, which takes most crossings out of the
 * small trees a plan's flow is). Pure; the Diagram tab draws the result and
 * measures nothing here.
 */

import type { FlowEdge, FlowNode } from './review-plan';

export interface PlacedNode {
  readonly node: FlowNode;
  /** Column, from 0. */
  readonly layer: number;
  /** Row within the column, from 0. */
  readonly row: number;
}

export interface FlowLayout {
  readonly placed: readonly PlacedNode[];
  /** Edges whose both ends were placed, in the input's order. */
  readonly edges: readonly FlowEdge[];
  readonly layers: number;
  /** The tallest column's row count. */
  readonly rows: number;
}

/** A node's layer is one past its deepest predecessor's; a cycle is broken where it closes. */
function layersOf(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let deepest = -1;
    for (const from of incoming.get(id) ?? []) deepest = Math.max(deepest, depth(from));
    visiting.delete(id);
    const value = deepest + 1;
    layer.set(id, value);
    return value;
  };
  for (const node of nodes) depth(node.id);
  return layer;
}

export function layoutFlow(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): FlowLayout {
  const ids = new Set(nodes.map((node) => node.id));
  const kept = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const layer = layersOf(nodes, kept);
  const columns = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const at = layer.get(node.id) ?? 0;
    const list = columns.get(at) ?? [];
    list.push(node);
    columns.set(at, list);
  }
  const layers = columns.size === 0 ? 0 : Math.max(...columns.keys()) + 1;
  const row = new Map<string, number>();
  const predecessors = new Map<string, string[]>();
  for (const edge of kept) {
    const list = predecessors.get(edge.to) ?? [];
    list.push(edge.from);
    predecessors.set(edge.to, list);
  }
  for (let at = 0; at < layers; at += 1) {
    const list = columns.get(at) ?? [];
    if (at > 0) {
      // Barycentre: a node sits near the mean row of what points at it; ties keep the input's order.
      const centre = new Map<string, number>();
      list.forEach((node, index) => {
        const rows = (predecessors.get(node.id) ?? []).map((from) => row.get(from)).filter((value): value is number => value !== undefined);
        centre.set(node.id, rows.length === 0 ? index : rows.reduce((sum, value) => sum + value, 0) / rows.length);
      });
      list.sort((a, b) => (centre.get(a.id) ?? 0) - (centre.get(b.id) ?? 0) || nodes.indexOf(a) - nodes.indexOf(b));
    }
    list.forEach((node, index) => row.set(node.id, index));
  }
  const placed: PlacedNode[] = nodes.map((node) => ({ node, layer: layer.get(node.id) ?? 0, row: row.get(node.id) ?? 0 }));
  const rows = columns.size === 0 ? 0 : Math.max(...[...columns.values()].map((list) => list.length));
  return { placed, edges: kept, layers, rows };
}
