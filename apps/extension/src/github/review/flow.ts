import { canReadImports, flowLinks, importSpecifiers, layoutFlow } from '@geld/core/file-flow';
import type { FlowComponent, FlowEdge, FlowRoute } from '@geld/core/file-flow';
import { formatCount } from '@geld/core/format';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { looksLikeHtml } from '../../lib/http';
import { pageFetch } from '../page-fetch';
import { ICON_CHEVRON_DOWN, ICON_FILE_ADDED, ICON_FILE_MODIFIED, ICON_FILE_MOVED, ICON_FILE_REMOVED, ICON_WORKFLOW, ICON_X } from '../ui/icons';

/**
 * The Flow dialog: the pull request's changed files as a diagram of which
 * file imports which. Each surviving file is read whole at the head from the
 * page's own `raw` route and removed imports come from the diff itself; both
 * are resolved against the other changed files by `@geld/core/file-flow` and
 * drawn as cards with SVG links. A card opens its file in Files changed.
 */

export type FlowFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface FlowFile {
  readonly path: string;
  readonly status: FlowFileStatus;
  readonly additions: number;
  readonly deletions: number;
  /** The hidden category the reader's settings put the file in ("Tests"), or null for an essential file. */
  readonly hiddenAs: string | null;
  /** The imports the diff's removed lines name (`FileStats.removedImports`): all of a deleted file's, those a surviving file dropped. */
  readonly removedImports: readonly string[];
}

export interface FlowSource {
  readonly origin: string;
  /** `owner/repo`. */
  readonly repo: string;
  /** `/owner/repo/pull/N`. */
  readonly pullPath: string;
  readonly headSha: string | null;
  readonly files: readonly FlowFile[];
}

const NODE_WIDTH = 224;
const NODE_HEIGHT = 58;
const ROW_GAP = 58;
const PAD = 28;
const PORT_SPREAD = 12;
const CORNER = 8;
const MAX_READS = 160;
const MAX_BYTES = 400_000;
const CONCURRENT_READS = 6;
const RENDER_DEBOUNCE_MS = 120;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

const STATUS_WORD: Readonly<Record<FlowFileStatus, string>> = { added: 'New', deleted: 'Removed', renamed: 'Renamed', modified: 'Changed' };
const STATUS_ICON: Readonly<Record<FlowFileStatus, string>> = { added: ICON_FILE_ADDED, deleted: ICON_FILE_REMOVED, renamed: ICON_FILE_MOVED, modified: ICON_FILE_MODIFIED };

let source: FlowSource | null = null;
/** The pull request and head the cached reads belong to. */
let sourceKey = '';

/** What the diagram is drawn from, set by the controller on every conversation pass (null elsewhere). */
export function setFlowSource(next: FlowSource | null): void {
  source = next;
  const key = next === null ? '' : `${next.origin}/${next.repo}${next.pullPath}@${next.headSha ?? ''}`;
  // Another pull request or a new head: what was read for the last one is never asked for again.
  if (key !== '' && key !== sourceKey) {
    sourceKey = key;
    forgetReads();
    // An open dialog reads again at the new head instead of waiting on answers that are now thrown away.
    onReadLanded?.();
  }
}

/** Close an open Flow dialog and drop every read still waiting (Geld turned off, or the digest torn down). */
export function closeFlow(): void {
  openDialog?.close();
  openDialog = null;
  onReadLanded = null;
  forgetReads();
}

/** Whether the Geld row offers Flow: the diff is in and holds more than one file. */
export function flowAvailable(): boolean {
  return source !== null && source.files.length > 1;
}

/** A file's read, kept as the imports it names: a few strings each, so a whole diagram's worth stays in memory and nothing is read twice. */
type Read = { readonly state: 'pending' } | { readonly state: 'ready'; readonly imports: readonly string[] } | { readonly state: 'failed' };

const reads = new Map<string, Read>();
const queue: Array<{ readonly key: string; readonly url: string; readonly path: string }> = [];
let active = 0;
/** Bumped whenever the cache is dropped, so an answer to a read from before is thrown away. */
let readGeneration = 0;
let onReadLanded: (() => void) | null = null;
let openDialog: HTMLDialogElement | null = null;

function forgetReads(): void {
  reads.clear();
  queue.length = 0;
  readGeneration += 1;
}

function rawUrl(origin: string, repo: string, revision: string, path: string): string {
  return `${origin}/${repo}/raw/${encodeURIComponent(revision)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function request(origin: string, repo: string, revision: string, path: string): Read {
  const key = `${origin}/${repo}@${revision}:${path}`;
  const known = reads.get(key);
  if (known !== undefined) return known;
  const pending: Read = { state: 'pending' };
  reads.set(key, pending);
  queue.push({ key, url: rawUrl(origin, repo, revision, path), path });
  pump();
  return pending;
}

function pump(): void {
  while (active < CONCURRENT_READS && queue.length > 0) {
    const job = queue.shift();
    if (job === undefined) return;
    active += 1;
    const generation = readGeneration;
    const land = (read: Read): void => {
      if (generation === readGeneration) reads.set(job.key, read);
    };
    void fetchText(job.url)
      .then((text) => land(text === null ? { state: 'failed' } : { state: 'ready', imports: importSpecifiers(job.path, text) }))
      .catch(() => land({ state: 'failed' }))
      .finally(() => {
        active -= 1;
        if (generation === readGeneration) onReadLanded?.();
        pump();
      });
  }
}

async function fetchText(url: string): Promise<string | null> {
  const response = await pageFetch(url, { credentials: 'same-origin', redirect: 'follow' });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > MAX_BYTES || looksLikeHtml(response.headers.get('content-type'), text)) return null;
  return text;
}

interface Reading {
  readonly after: ReadonlyMap<string, readonly string[]>;
  readonly before: ReadonlyMap<string, readonly string[]>;
  readonly deleted: ReadonlySet<string>;
  readonly wanted: number;
  readonly landed: number;
  readonly unreadable: boolean;
}

/**
 * Each file's imports after the change, read whole at the head (surviving files only, in essential-first order,
 * at most `MAX_READS`), and the imports the diff's removed lines name (`FlowFile.removedImports`: all of a deleted
 * file's, those a surviving file dropped). The diff is against the merge base, so a link drawn as removed was there
 * when the pull request branched off, not merely on the base branch's tip.
 */
function readFiles(current: FlowSource, files: readonly FlowFile[]): Reading {
  const after = new Map<string, readonly string[]>();
  const before = new Map<string, readonly string[]>();
  const readable = files.filter((file) => canReadImports(file.path));
  const deleted = new Set(files.filter((file) => file.status === 'deleted').map((file) => file.path));
  for (const file of readable) if (file.removedImports.length > 0) before.set(file.path, file.removedImports);
  if (current.headSha === null) return { after, before, deleted, wanted: 0, landed: 0, unreadable: readable.some((file) => file.status !== 'deleted') };
  const headSha = current.headSha;
  let wanted = 0;
  let landed = 0;
  const ordered = [...readable].sort((a, b) => Number(a.hiddenAs !== null) - Number(b.hiddenAs !== null));
  for (const file of ordered) {
    if (file.status === 'deleted' || wanted >= MAX_READS) continue;
    wanted += 1;
    const read = request(current.origin, current.repo, headSha, file.path);
    if (read.state !== 'pending') landed += 1;
    if (read.state === 'ready') after.set(file.path, read.imports);
  }
  return { after, before, deleted, wanted, landed, unreadable: false };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The Files changed tab as the page links to it (keeping any `?w=1` Geld or the reader put there), else `/files`. */
function filesTabHref(pullPath: string): string {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"]')) {
    const url = new URL(link.href, location.href);
    if (url.pathname === `${pullPath}/files` || url.pathname === `${pullPath}/changes`) {
      url.hash = '';
      return url.toString();
    }
  }
  return `${location.origin}${pullPath}/files`;
}

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

/** The icon GitHub's file tree gives the change: file-added, file-diff, file-moved, file-removed, in its colours. */
function statusIcon(status: FlowFileStatus): SVGElement {
  const glyph = icon(STATUS_ICON[status]);
  glyph.classList.add('geld-flow__status-icon');
  return glyph;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The file's folder by its nearest two levels (`…/src/github/`): the start of a long path says the least. */
function directoryOf(path: string): string {
  const parts = path.split('/').slice(0, -1);
  if (parts.length === 0) return '';
  return parts.length > 2 ? `\u2026/${parts.slice(-2).join('/')}/` : `${parts.join('/')}/`;
}

function card(file: FlowFile, filesHref: string, onOpen: () => void): HTMLAnchorElement {
  const directory = directoryOf(file.path);
  const meta = createElement('span', { class: 'geld-flow__meta' }, [statusIcon(file.status), createElement('span', { class: 'geld-flow__status' }, [STATUS_WORD[file.status]])]);
  if (directory !== '') meta.append(createElement('span', { class: 'geld-flow__dir' }, [directory]));
  const counts = createElement('span', { class: 'geld-flow__counts' });
  if (file.additions > 0) counts.append(createElement('span', { class: 'geld-flow__add' }, [`+${formatCount(file.additions)}`]));
  if (file.deletions > 0) counts.append(createElement('span', { class: 'geld-flow__del' }, [`\u2212${formatCount(file.deletions)}`]));
  const name = createElement('span', { class: 'geld-flow__name-row' }, [createElement('span', { class: 'geld-flow__name' }, [nameOf(file.path)]), counts]);
  const label = `${STATUS_WORD[file.status]} file ${file.path}${file.hiddenAs === null ? '' : `, ${file.hiddenAs}`}. Open in Files changed`;
  const node = createElement('a', { class: 'geld-flow__node', href: filesHref, 'data-status': file.status, 'data-path': file.path, title: file.path, 'aria-label': label }, [meta, name]);
  if (file.hiddenAs !== null) {
    node.setAttribute('data-hidden', '');
    meta.append(createElement('span', { class: 'geld-flow__tag' }, [file.hiddenAs]));
  }
  void sha256Hex(file.path).then((hash) => (node.href = `${filesHref}#diff-${hash}`));
  node.addEventListener('click', () => onOpen());
  return node;
}

/** An orthogonal path through `points` with rounded corners. */
function roundedPath(points: ReadonlyArray<readonly [number, number]>): string {
  const first = points[0];
  if (first === undefined) return '';
  let d = `M${first[0]},${first[1]}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (previous === undefined || corner === undefined || next === undefined) continue;
    const inLength = Math.hypot(corner[0] - previous[0], corner[1] - previous[1]);
    const outLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const radius = Math.min(CORNER, inLength / 2, outLength / 2);
    if (radius < 0.5) {
      d += ` L${corner[0]},${corner[1]}`;
      continue;
    }
    const start: readonly [number, number] = [corner[0] - ((corner[0] - previous[0]) / inLength) * radius, corner[1] - ((corner[1] - previous[1]) / inLength) * radius];
    const end: readonly [number, number] = [corner[0] + ((next[0] - corner[0]) / outLength) * radius, corner[1] + ((next[1] - corner[1]) / outLength) * radius];
    d += ` L${start[0]},${start[1]} Q${corner[0]},${corner[1]} ${end[0]},${end[1]}`;
  }
  const last = points[points.length - 1];
  if (last !== undefined && points.length > 1) d += ` L${last[0]},${last[1]}`;
  return d;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string>>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/** Where each link leaves and enters its files: links sharing a side are spread a little, in the order their other ends lie. */
function ports(component: FlowComponent): Map<FlowRoute, { readonly start: number; readonly end: number }> {
  const sides = new Map<string, Array<{ readonly route: FlowRoute; readonly toward: number; readonly end: 'start' | 'end' }>>();
  const add = (key: string, route: FlowRoute, toward: number, end: 'start' | 'end'): void => {
    const list = sides.get(key) ?? [];
    list.push({ route, toward, end });
    sides.set(key, list);
  };
  for (const route of component.routes) {
    const first = route.points[0];
    const second = route.points[1];
    const last = route.points[route.points.length - 1];
    const beforeLast = route.points[route.points.length - 2];
    if (first === undefined || second === undefined || last === undefined || beforeLast === undefined) continue;
    const up = second.row < first.row;
    add(`${route.edge.from}:${up ? 'top' : 'bottom'}`, route, second.x, 'start');
    add(`${route.edge.to}:${up ? 'bottom' : 'top'}`, route, beforeLast.x, 'end');
  }
  const offsets = new Map<FlowRoute, { start: number; end: number }>();
  for (const list of sides.values()) {
    list.sort((a, b) => a.toward - b.toward);
    const spread = Math.min(PORT_SPREAD, (NODE_WIDTH * 0.6) / Math.max(1, list.length - 1));
    list.forEach((entry, index) => {
      const offset = (index - (list.length - 1) / 2) * spread;
      const current = offsets.get(entry.route) ?? { start: 0, end: 0 };
      current[entry.end] = offset;
      offsets.set(entry.route, current);
    });
  }
  return offsets;
}

function drawComponent(component: FlowComponent, files: ReadonlyMap<string, FlowFile>, filesHref: string, onOpen: () => void): HTMLElement {
  const width = Math.ceil(component.width * NODE_WIDTH) + PAD * 2;
  const height = component.rows.length * NODE_HEIGHT + (component.rows.length - 1) * ROW_GAP + PAD * 2;
  const graph = createElement('div', { class: 'geld-flow__graph', style: `width:${width}px;height:${height}px` });
  const svg = svgElement('svg', { class: 'geld-flow__links', width: String(width), height: String(height), viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  const defs = svgElement('defs', {});
  const marker = svgElement('marker', { id: 'geld-flow-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.append(svgElement('path', { d: 'M0,0.5 L7.5,4 L0,7.5 Z', class: 'geld-flow__arrow' }));
  defs.append(marker);
  svg.append(defs);
  graph.append(svg);
  const rowTop = (row: number): number => PAD + row * (NODE_HEIGHT + ROW_GAP);
  const px = (x: number): number => PAD + x * NODE_WIDTH;
  const offsets = ports(component);
  for (const route of component.routes) {
    const points: Array<readonly [number, number]> = [];
    const offset = offsets.get(route) ?? { start: 0, end: 0 };
    const count = route.points.length;
    route.points.forEach((point, index) => {
      const next = route.points[index + 1];
      const previous = route.points[index - 1];
      const x = px(point.x) + (index === 0 ? offset.start : index === count - 1 ? offset.end : 0);
      const top = rowTop(point.row);
      if (index === 0 && next !== undefined) {
        points.push([x, next.row > point.row ? top + NODE_HEIGHT : top]);
      } else if (index === count - 1 && previous !== undefined) {
        points.push([x, previous.row < point.row ? top - 2 : top + NODE_HEIGHT + 2]);
        return;
      } else {
        // A bend point: the link runs straight through its row.
        const down = previous !== undefined && previous.row < point.row;
        points.push([x, down ? top : top + NODE_HEIGHT], [x, down ? top + NODE_HEIGHT : top]);
      }
      if (next !== undefined) {
        const down = next.row > point.row;
        const middle = down ? rowTop(point.row) + NODE_HEIGHT + ROW_GAP / 2 : rowTop(point.row) - ROW_GAP / 2;
        const last = points[points.length - 1];
        const nextX = px(next.x) + (index + 1 === count - 1 ? offset.end : 0);
        if (last !== undefined && Math.abs(last[0] - nextX) > 0.5) points.push([last[0], middle], [nextX, middle]);
      }
    });
    const path = svgElement('path', { d: roundedPath(points), class: 'geld-flow__link', 'data-from': route.edge.from, 'data-to': route.edge.to, 'marker-end': 'url(#geld-flow-arrow)' });
    if (route.edge.removed === true) path.setAttribute('data-removed', '');
    svg.append(path);
  }
  component.rows.forEach((row, rowIndex) => {
    for (const slot of row) {
      if (slot.kind !== 'file') continue;
      const file = files.get(slot.path);
      if (file === undefined) continue;
      const node = card(file, filesHref, onOpen);
      node.style.left = `${px(slot.x) - NODE_WIDTH / 2}px`;
      node.style.top = `${rowTop(rowIndex)}px`;
      graph.append(node);
    }
  });
  // Resting on a file brings its links forward and quiets the rest.
  graph.addEventListener('pointerover', (event) => {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('.geld-flow__node') : null;
    const path = node?.getAttribute('data-path') ?? null;
    if (path === null) return;
    graph.setAttribute('data-focus', '');
    for (const link of svg.querySelectorAll('.geld-flow__link')) {
      link.toggleAttribute('data-lit', link.getAttribute('data-from') === path || link.getAttribute('data-to') === path);
    }
  });
  graph.addEventListener('pointerleave', () => {
    graph.removeAttribute('data-focus');
    for (const link of svg.querySelectorAll('[data-lit]')) link.removeAttribute('data-lit');
  });
  return graph;
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;
}

let dialogIds = 0;

/** Open the Flow dialog for the current pull request. Escape, the close button or a click on the backdrop closes it. */
export function openFlowDialog(): void {
  const opened = source;
  if (opened === null) return;
  // What each render draws from: the latest source while it is still this pull request (a push lands, or the
  // head becomes known, while the dialog is open), else the one it opened with.
  const latest = (): FlowSource => (source !== null && source.origin === opened.origin && source.pullPath === opened.pullPath ? source : opened);
  dialogIds += 1;
  const titleId = `geld-flow-${dialogIds}-title`;
  const dialog = createElement('dialog', { class: 'Overlay Overlay--motion-scaleFade geld-flow', [OWN_UI_ATTRIBUTE]: '', 'aria-labelledby': titleId });
  const close = createElement('button', { type: 'button', class: 'close-button Overlay-closeButton', 'aria-label': 'Close' }, [icon(ICON_X)]);
  const hiddenCount = opened.files.filter((file) => file.hiddenAs !== null).length;
  const essentialCount = opened.files.length - hiddenCount;
  let showHidden = essentialCount === 0;
  const toggle = createElement('button', { type: 'button', class: 'btn btn-sm geld-flow__toggle', 'aria-pressed': String(showHidden) });
  const actions = createElement('div', { class: 'Overlay-actionWrap geld-flow__actions' }, [...(hiddenCount > 0 && essentialCount > 0 ? [toggle] : []), close]);

  // The diagram scrolls inside the stage; the controls (the legend, then zoom) float over its lower right corner and stay put.
  const scroller = createElement('div', { class: 'geld-flow__scroll' });
  const canvas = createElement('div', { class: 'geld-flow__canvas' });
  scroller.append(canvas);
  const status = createElement('p', { class: 'geld-flow__reading', role: 'status', hidden: '' });
  const legendList = createElement('div', { class: 'geld-flow__legend', id: `geld-flow-${dialogIds}-legend`, hidden: '' }, (['added', 'modified', 'renamed', 'deleted'] as const).map((key) => createElement('span', { class: 'geld-flow__legend-item' }, [statusIcon(key), STATUS_WORD[key]])));
  const chevron = icon(ICON_CHEVRON_DOWN);
  chevron.classList.add('geld-flow__chevron');
  const legendButton = createElement('button', { type: 'button', class: 'geld-flow__ctl geld-flow__legend-btn', 'aria-expanded': 'false', 'aria-controls': legendList.id }, ['Legend', chevron]);
  legendButton.addEventListener('click', () => {
    const open = legendList.hidden;
    legendList.hidden = !open;
    legendButton.setAttribute('aria-expanded', String(open));
  });
  const zoomOut = createElement('button', { type: 'button', class: 'geld-flow__ctl geld-flow__ctl--square', 'aria-label': 'Zoom out' }, ['\u2212']);
  const zoomLevel = createElement('button', { type: 'button', class: 'geld-flow__ctl geld-flow__zoom-level', title: 'Fit to the window' });
  const zoomIn = createElement('button', { type: 'button', class: 'geld-flow__ctl geld-flow__ctl--square', 'aria-label': 'Zoom in' }, ['+']);
  const controls = createElement('div', { class: 'geld-flow__controls' }, [
    legendList,
    legendButton,
    createElement('div', { class: 'geld-flow__zoom', role: 'group', 'aria-label': 'Zoom' }, [zoomOut, zoomLevel, zoomIn]),
  ]);
  const body = createElement('div', { class: 'Overlay-body geld-flow__stage' }, [scroller, status, controls]);
  let scale: number | null = null;
  const applyScale = (next: number): void => {
    scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
    canvas.style.zoom = String(scale);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    zoomOut.disabled = scale <= ZOOM_MIN;
    zoomIn.disabled = scale >= ZOOM_MAX;
  };
  /** The widest graph, scaled to the room the stage has (never above 100%). */
  const fitScale = (): number => {
    const widest = Math.max(0, ...[...canvas.querySelectorAll<HTMLElement>('.geld-flow__graph')].map((graph) => graph.offsetWidth));
    return widest === 0 ? 1 : Math.min(1, (scroller.clientWidth - 16) / widest);
  };
  zoomOut.addEventListener('click', () => applyScale((scale ?? 1) - ZOOM_STEP));
  zoomIn.addEventListener('click', () => applyScale((scale ?? 1) + ZOOM_STEP));
  zoomLevel.addEventListener('click', () => applyScale(fitScale()));
  dialog.append(
    createElement('div', { class: 'Overlay-header geld-flow__header' }, [
      createElement('div', { class: 'Overlay-headerContentWrap' }, [
        createElement('div', { class: 'Overlay-titleWrap' }, [createElement('h1', { class: 'Overlay-title geld-flow__title', id: titleId }, [icon(ICON_WORKFLOW), 'Flow'])]),
        actions,
      ]),
    ]),
    body,
  );
  const filesHref = filesTabHref(opened.pullPath);
  let timer = 0;
  // Closing queues the dialog's `close` event, which removes it: a card's click finishes reaching GitHub's own
  // link handling (a Turbo visit to Files changed) while the card is still in the document.
  const dismiss = (): void => {
    window.clearTimeout(timer);
    if (dialog.open) dialog.close();
  };
  let fitted = false;
  const render = (): void => {
    const current = latest();
    const files = current.files.filter((file) => showHidden || file.hiddenAs === null);
    const hiddenNow = current.files.length - current.files.filter((file) => file.hiddenAs === null).length;
    toggle.textContent = showHidden ? `Hide ${plural(hiddenNow, 'hidden file')}` : `Show ${plural(hiddenNow, 'hidden file')}`;
    toggle.setAttribute('aria-pressed', String(showHidden));
    const reading = readFiles(current, files);
    const edges: FlowEdge[] = flowLinks(
      files.map((file) => file.path),
      reading.after,
      reading.before,
      reading.deleted,
    );
    const layout = layoutFlow(
      files.map((file) => file.path),
      edges,
    );
    const byPath = new Map(files.map((file) => [file.path, file]));
    const stillReading = reading.landed < reading.wanted;
    status.hidden = !stillReading;
    status.textContent = stillReading ? `Reading ${formatCount(reading.landed)} of ${plural(reading.wanted, 'file')}…` : '';
    const scrollTop = scroller.scrollTop;
    const scrollLeft = scroller.scrollLeft;
    canvas.replaceChildren();
    for (const component of layout.components) canvas.append(drawComponent(component, byPath, filesHref, dismiss));
    if (layout.loose.length > 0) {
      const section = createElement('section', { class: 'geld-flow__loose' }, [createElement('h2', { class: 'geld-flow__loose-title' }, [layout.components.length === 0 ? 'Changed files' : 'Not linked to other changes'])]);
      const grid = createElement('div', { class: 'geld-flow__loose-grid' });
      for (const path of layout.loose) {
        const file = byPath.get(path);
        if (file !== undefined) grid.append(card(file, filesHref, dismiss));
      }
      section.append(grid);
      canvas.append(section);
    }
    if (reading.unreadable) canvas.prepend(createElement('p', { class: 'geld-flow__note' }, ['Geld could not tell which commit this page shows, so it drew the files without their links.']));
    scroller.scrollTop = scrollTop;
    scroller.scrollLeft = scrollLeft;
    // Fitted once the links are in (a diagram drawn while files are still being read is narrower); the reader's own zoom stays.
    if (!stillReading && !fitted) {
      fitted = true;
      applyScale(fitScale());
    }
  };
  onReadLanded = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (dialog.isConnected) render();
    }, RENDER_DEBOUNCE_MS);
  };
  toggle.addEventListener('click', () => {
    showHidden = !showHidden;
    fitted = false;
    render();
  });
  close.addEventListener('click', dismiss);
  // A click on the backdrop lands on the dialog element itself, outside its children.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('close', () => {
    if (openDialog === dialog) {
      openDialog = null;
      onReadLanded = null;
    }
    window.clearTimeout(timer);
    dialog.remove();
  });
  openDialog?.close();
  openDialog = dialog;
  document.body.append(dialog);
  dialog.showModal();
  applyScale(1);
  render();
  close.focus();
}
