/**
 * The Diagram tab: the plan's before/after flow drawn large. Boxes are laid
 * out by `@geld/review`'s `layoutFlow` (columns by longest path, rows by
 * barycentre) into a CSS grid of columns, each a centred stack; the arrows
 * are an SVG overlay drawn from the boxes' measured positions once the view
 * is in the document, and redrawn when the flow's box changes size. A box
 * names its kind (New, Changed, Existing, a Decision), its file and the
 * function or question, and carries the number of the step where it is
 * read; clicking it opens that step in the Review tab.
 */

import type { FlowEdge, FlowNode, FlowNodeKind, PlanOverview, ReviewPlan } from '@geld/review';
import { layoutFlow } from '@geld/review';
import { createElement, svgFromString } from '../dom';
import { inlineText } from '../review/inline-text';
import { ICON_SPARKLE_FILL } from '../ui/icons';

const ROOT = 'geld-review-tab';
const C = (suffix: string): string => `${ROOT}__${suffix}`;
const ATTR_NODE = 'data-geld-flow-node';
const ATTR_EDGE_FROM = 'data-from';
const ATTR_EDGE_TO = 'data-to';
const ARROW_ID = 'geld-rt-arrow';

const KIND_WORDS: Readonly<Record<FlowNodeKind, string>> = { new: 'New', changed: 'Changed', existing: 'Existing', decision: 'Decision' };

export interface DiagramHandlers {
  readonly openStep: (id: string) => void;
  readonly planWithAi: () => void;
}

export interface DiagramModel {
  readonly plan: ReviewPlan | null;
  readonly loaded: boolean;
  readonly planning: boolean;
  readonly aiModel: string | null;
}

/** The whole Diagram tab's content, spanning the view. */
export function renderDiagram(model: DiagramModel, handlers: DiagramHandlers): HTMLElement {
  const section = createElement('section', { class: C('diagram'), 'aria-label': 'Diagram' });
  const flow = model.plan?.overview?.flow ?? null;
  if (flow === null || model.plan === null) {
    section.append(renderDiagramEmpty(model, handlers));
    return section;
  }
  const overview = model.plan.overview;
  if (overview !== undefined && overview.summary !== '') section.append(createElement('p', { class: C('diagram-summary') }, inlineText(overview.summary)));
  const head = createElement('header', { class: C('diagram-head') });
  head.append(createElement('h2', { class: C('diagram-title') }, ['Before / after']));
  if (flow.caption !== '') head.append(createElement('span', { class: C('diagram-caption') }, [flow.caption]));
  head.append(renderLegend(flow.nodes));
  section.append(head);
  section.append(renderFlow(flow.nodes, flow.edges, model.plan, handlers));
  if (model.plan.model !== null) section.append(createElement('p', { class: C('story-by') }, [svgFromString(ICON_SPARKLE_FILL), ` ${model.plan.model}`]));
  return section;
}

function renderDiagramEmpty(model: DiagramModel, handlers: DiagramHandlers): HTMLElement {
  const box = createElement('div', { class: C('empty') });
  if (!model.loaded || model.plan === null) {
    box.append(createElement('h2', { class: C('empty-title'), 'data-pending': '' }, ['Reading the diff…']));
    return box;
  }
  if (model.planning) {
    box.append(createElement('h2', { class: C('empty-title'), 'data-pending': '' }, [`Planning with ${model.aiModel ?? 'the model'}…`]), createElement('p', { class: C('empty-words') }, ['The diagram is drawn with the steps.']));
    return box;
  }
  box.append(createElement('h2', { class: C('empty-title') }, ['No diagram yet']));
  if (model.aiModel === null) {
    box.append(createElement('p', { class: C('empty-words') }, ['The diagram is drawn by the AI model when it plans the steps. Set an AI model in Geld’s options to get one.']));
    return box;
  }
  if (model.plan.producer === 'ai') {
    box.append(createElement('p', { class: C('empty-words') }, ['The model drew no flow for this pull request. Planning again may give one.']));
  } else {
    box.append(createElement('p', { class: C('empty-words') }, ['The diagram is drawn by the AI model when it plans the steps.']));
  }
  const plan = createElement('button', { type: 'button', class: 'btn btn-sm btn-primary' }, [svgFromString(ICON_SPARKLE_FILL), model.plan.producer === 'ai' ? 'Plan again' : 'Plan with AI']);
  plan.addEventListener('click', () => handlers.planWithAi());
  box.append(plan);
  return box;
}

function renderLegend(nodes: readonly FlowNode[]): HTMLElement {
  const legend = createElement('ul', { class: C('diagram-legend'), 'aria-label': 'Legend' });
  const kinds = new Set(nodes.map((node) => node.kind));
  for (const kind of ['new', 'changed', 'existing', 'decision'] as const) {
    if (!kinds.has(kind)) continue;
    legend.append(createElement('li', { 'data-kind': kind }, [createElement('span', { class: C('flow-dot'), 'aria-hidden': 'true' }), KIND_WORDS[kind]]));
  }
  return legend;
}

function renderFlow(nodes: readonly FlowNode[], edges: readonly FlowEdge[], plan: ReviewPlan, handlers: DiagramHandlers): HTMLElement {
  const layout = layoutFlow(nodes, edges);
  const flow = createElement('div', { class: C('flow'), style: `--geld-rt-layers:${Math.max(1, layout.layers)}` });
  const grid = createElement('div', { class: C('flow-grid') });
  const columns: HTMLElement[] = [];
  for (let layer = 0; layer < layout.layers; layer += 1) {
    const column = createElement('div', { class: C('flow-column') });
    columns.push(column);
    grid.append(column);
  }
  const ordered = [...layout.placed].sort((a, b) => a.layer - b.layer || a.row - b.row);
  for (const placed of ordered) {
    const node = placed.node;
    const index = node.step === null ? -1 : plan.steps.findIndex((step) => step.id === node.step);
    const step = plan.steps[index];
    const box = createElement(step === undefined ? 'div' : 'button', { class: C('flow-node'), 'data-kind': node.kind, [ATTR_NODE]: node.id, ...(step === undefined ? {} : { type: 'button', title: `Step ${index + 1}: ${step.title}` }) });
    const head = createElement('span', { class: C('flow-node-head') }, [createElement('span', { class: C('flow-dot'), 'aria-hidden': 'true' }), createElement('span', { class: C('flow-kind') }, [KIND_WORDS[node.kind]])]);
    if (node.file !== null) head.append(createElement('span', { class: C('flow-file') }, [node.file]));
    box.append(head);
    const label = createElement('span', { class: C('flow-label') }, [node.kind === 'decision' ? node.label : createElement('code', {}, [node.label])]);
    box.append(label);
    if (step !== undefined) {
      box.append(createElement('span', { class: C('flow-step') }, [String(index + 1).padStart(2, '0')]));
      box.addEventListener('click', () => handlers.openStep(step.id));
    }
    columns[placed.layer]?.append(box);
  }
  flow.append(grid);
  const overlay = svgFromString(`<svg class="${C('flow-edges')}" aria-hidden="true" focusable="false"><defs><marker id="${ARROW_ID}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs></svg>`);
  for (const edge of layout.edges) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(ATTR_EDGE_FROM, edge.from);
    path.setAttribute(ATTR_EDGE_TO, edge.to);
    path.setAttribute('marker-end', `url(#${ARROW_ID})`);
    overlay.append(path);
  }
  flow.append(overlay);
  for (const edge of layout.edges) {
    if (edge.label === null) continue;
    flow.append(createElement('span', { class: C('flow-edge-label'), [ATTR_EDGE_FROM]: edge.from, [ATTR_EDGE_TO]: edge.to }, [edge.label]));
  }
  return flow;
}

/**
 * Draw the arrows from the boxes' positions: each from its source's right
 * edge to its target's left edge as a cubic curve, the label at the middle.
 * Needs the flow in the document (a detached box measures nothing).
 */
export function drawFlowEdges(root: ParentNode): void {
  const flow = root.querySelector<HTMLElement>(`.${C('flow')}`);
  const overlay = flow?.querySelector<SVGSVGElement>(`.${C('flow-edges')}`);
  if (flow === undefined || flow === null || overlay === undefined || overlay === null) return;
  // The overlay fills the padding box (`inset: 0` on an absolute child), so it is sized and offset from that, not the border box.
  const box = flow.getBoundingClientRect();
  const originX = box.left + flow.clientLeft - flow.scrollLeft;
  const originY = box.top + flow.clientTop;
  const width = flow.scrollWidth;
  const height = flow.clientHeight;
  overlay.setAttribute('width', String(width));
  overlay.setAttribute('height', String(height));
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rectOf = (id: string): DOMRect | null => flow.querySelector<HTMLElement>(`[${ATTR_NODE}="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null;
  const midpoints = new Map<string, readonly [number, number]>();
  for (const path of overlay.querySelectorAll<SVGPathElement>('path[data-from]')) {
    const from = rectOf(path.getAttribute(ATTR_EDGE_FROM) ?? '');
    const to = rectOf(path.getAttribute(ATTR_EDGE_TO) ?? '');
    if (from === null || to === null) continue;
    const x1 = from.right - originX;
    const y1 = from.top + from.height / 2 - originY;
    const x2 = to.left - originX;
    const y2 = to.top + to.height / 2 - originY;
    const bend = Math.max(24, (x2 - x1) / 2);
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    midpoints.set(`${path.getAttribute(ATTR_EDGE_FROM)}>${path.getAttribute(ATTR_EDGE_TO)}`, [(x1 + x2) / 2, (y1 + y2) / 2]);
  }
  for (const label of flow.querySelectorAll<HTMLElement>(`.${C('flow-edge-label')}`)) {
    const at = midpoints.get(`${label.getAttribute(ATTR_EDGE_FROM)}>${label.getAttribute(ATTR_EDGE_TO)}`);
    if (at === undefined) continue;
    label.style.left = `${Math.round(at[0])}px`;
    label.style.top = `${Math.round(at[1])}px`;
  }
}

/** Redraw the arrows whenever the flow's box changes size (fonts landing, the window resizing); returns the disposer. */
export function watchDiagram(root: ParentNode): (() => void) | null {
  const flow = root.querySelector<HTMLElement>(`.${C('flow')}`);
  if (flow === null) return null;
  const observer = new ResizeObserver(() => drawFlowEdges(root));
  observer.observe(flow);
  return () => observer.disconnect();
}

/** Whether the plan has anything for the Diagram tab to draw. */
export function hasDiagram(overview: PlanOverview | undefined): boolean {
  return overview?.flow !== null && overview?.flow !== undefined && overview.flow.nodes.length > 0;
}
