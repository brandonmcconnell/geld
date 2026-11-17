import { canReadImports, flowLinks, importSpecifiers, layoutFlow } from '@geld/core/file-flow';
import type { FlowComponent, FlowEdge, FlowRoute } from '@geld/core/file-flow';
import { formatCount } from '@geld/core/format';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../github/dom';
import { cancelIdle, whenIdle } from '../lib/idle';
import { ICON_CHEVRON_DOWN, ICON_FILE_ADDED, ICON_FILE_MODIFIED, ICON_FILE_MOVED, ICON_FILE_REMOVED, ICON_WORKFLOW, ICON_X } from '../github/ui/icons';
import { countUsage } from '../lib/usage-count';
import './flow.css';

/**
 * The Flow dialog: a review's changed files as a diagram of which file imports
 * which, the same on every host. Each surviving file is read whole at the head
 * through the host (`FlowHost.read`) and removed imports come from the diff
 * itself; both are resolved against the other changed files by
 * `@geld/core/file-flow` and drawn as cards with SVG links. A card opens its
 * file in the host's diff tab.
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

/** `pending` while the diff is still on its way, `too-large` past the diff host's limit, `unavailable` when it failed. */
export type FlowRemovedLinks = 'known' | 'pending' | 'too-large' | 'unavailable';

export interface FlowSource {
  /** The review and the head its files are read at; a new key drops every read made for the last one. */
  readonly key: string;
  /** Whether the head the files are read at is known: without it the files are drawn without their links. */
  readonly headKnown: boolean;
  readonly files: readonly FlowFile[];
  /** Whether the files carry the imports the diff removed: `known` from the diff, else summaries stand in for it. */
  readonly removed: FlowRemovedLinks;
  /** Anything else the host wants said above the diagram (a partial file list). */
  readonly notes?: readonly string[];
}

/** Why the review's diff is not here, as the dialog says it in the diagram's place. */
export interface FlowFailure {
  /** The review it is for ({@link FlowHost.review}). */
  readonly review: string;
  readonly text: string;
  /** Still asked for again on its own: said politely, with no Reload. */
  readonly retrying: boolean;
  readonly reload: boolean;
}

/**
 * What differs between hosts: how a file is read and linked, the words for the
 * review and its diff tab, how many reads may run at once, and the classes the
 * host's own buttons and dialog wear.
 */
export interface FlowHost {
  /** The review the dialog is for: its source and failures carry the same string. */
  readonly review: string;
  /** "pull request" or "merge request". */
  readonly reviewNoun: string;
  /** The host's diff tab, as its cards say: "Files changed", "Changes". */
  readonly filesTab: string;
  /** Reads that may run before the dialog is opened, and once it is open. */
  readonly concurrency: { readonly prefetch: number; readonly open: number };
  /** The most files read for one review. */
  readonly maxReads: number;
  /** A surviving file's text at the head, or null when it cannot be had; aborted when the reads are dropped. */
  read(path: string, signal: AbortSignal): Promise<string | null>;
  /** Where a card leads before its own link is known. */
  filesHref(): string;
  /** The file's own place in the diff tab, or null to keep {@link filesHref}. */
  fileHref(path: string): string | null | Promise<string | null>;
  /** Moves the page to the file itself (a native file tree), true when it did, so the card's link is not followed. */
  navigate?(path: string): boolean;
  readonly skin: FlowSkin;
}

/** Classes the host's own controls wear: GitHub's Primer buttons, or a provider's. */
export interface FlowSkin {
  /** Set on the dialog, so a host's stylesheet can give the frame its own look. */
  readonly name: string;
  /** Classes the dialog wears besides its own: a provider's `geld-primer-bridge`. */
  readonly dialog?: string;
  readonly button: string;
  readonly closeButton: string;
}

const REMOVED_NOTE: Readonly<Record<Exclude<FlowRemovedLinks, 'known'>, string>> = {
  pending: 'Links a change removed are drawn once the diff arrives.',
  'too-large': 'The diff is over 20 MB, so links a change removed are not drawn.',
  unavailable: 'The diff could not be loaded, so links a change removed are not drawn.',
};

const NODE_WIDTH = 224;
const NODE_HEIGHT = 58;
const ROW_GAP = 58;
const PAD = 28;
const PORT_SPREAD = 12;
const CORNER = 8;
const MAX_BYTES = 400_000;
const READ_TIMEOUT_MS = 15_000;
const PREFETCH_IDLE_MS = 2000;
const PREFETCH_IDLE_KEY = 'geld-flow-prefetch';
const RENDER_DEBOUNCE_MS = 120;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

const STATUS_WORD: Readonly<Record<FlowFileStatus, string>> = { added: 'New', deleted: 'Removed', renamed: 'Renamed', modified: 'Changed' };
const STATUS_ICON: Readonly<Record<FlowFileStatus, string>> = { added: ICON_FILE_ADDED, deleted: ICON_FILE_REMOVED, renamed: ICON_FILE_MOVED, modified: ICON_FILE_MODIFIED };

let host: FlowHost | null = null;
let source: FlowSource | null = null;
let failure: FlowFailure | null = null;
/** The review and head the cached reads belong to. */
let sourceKey = '';
let markers = 0;

/** The changed files as the host last handed them over, for the chat assistant; empty for any other review. */
export function flowFiles(review: string): readonly FlowFile[] {
  return source !== null && host?.review === review ? source.files : [];
}

/** What the diagram is drawn from, set by the host on every pass (null elsewhere), with the diff's failure while it has none. */
export function setFlowSource(nextHost: FlowHost | null, next: FlowSource | null, failed: FlowFailure | null = null): void {
  host = nextHost;
  source = nextHost === null ? null : next;
  const failedBefore = failure;
  failure = next === null && nextHost !== null ? failed : null;
  if (openDialog !== null && failureKey(failure) !== failureKey(failedBefore)) onReadLanded?.();
  const key = source === null ? '' : source.key;
  prefetch(source, key);
  // Another review or a new head: what was read for the last one is never asked for again.
  if (key !== '' && key !== sourceKey) {
    sourceKey = key;
    forgetReads();
    // An open dialog reads again at the new head instead of waiting on answers that are now thrown away.
    onReadLanded?.();
    return;
  }
  // Same head, other file data: the diff landed after the host's file summaries (which carry no removed imports), or
  // the reader's settings now hide other files. Only worked out while a dialog is open, since this runs every pass.
  if (openDialog !== null && source !== null) {
    const data = fileData(source);
    if (data !== openData) {
      openData = data;
      onReadLanded?.();
    }
  }
}

function failureKey(from: FlowFailure | null): string {
  return from === null ? '' : `${from.review}\u0000${from.text}\u0000${String(from.retrying)}`;
}

/** The source a background read was last started for, so each review and head is read ahead once. */
let prefetchedKey = '';

/** Read every file's imports ahead of a click (essential first), so the dialog opens on the finished diagram. */
function prefetch(next: FlowSource | null, key: string): void {
  if (next === null || !next.headKnown || key === prefetchedKey) return;
  prefetchedKey = key;
  whenIdle(
    PREFETCH_IDLE_KEY,
    () => {
      if (key === sourceKey) readFiles(next, next.files);
    },
    PREFETCH_IDLE_MS,
  );
}

/** What an open dialog draws from besides the reads: each file's status, category and removed imports. */
function fileData(from: FlowSource): string {
  return from.removed + '\u0002' + (from.notes ?? []).join('\u0003') + '\u0002' + from.files.map((file) => `${file.path}\u0000${file.status}\u0000${file.hiddenAs ?? ''}\u0000${file.removedImports.join(',')}`).join('\u0001');
}

/** Close an open Flow dialog and drop every read still waiting (Geld turned off, or the digest torn down). */
export function closeFlow(): void {
  openDialog?.close();
  openDialog = null;
  onReadLanded = null;
  cancelIdle(PREFETCH_IDLE_KEY);
  prefetchedKey = '';
  forgetReads();
}

/** A file's read, kept as the imports it names: a few strings each, so a whole diagram's worth stays in memory and nothing is read twice. */
type Read = { readonly state: 'pending' } | { readonly state: 'ready'; readonly imports: readonly string[] } | { readonly state: 'failed' };

const reads = new Map<string, Read>();
const queue: Array<{ readonly key: string; readonly path: string; readonly from: FlowHost }> = [];
let active = 0;
/** Bumped whenever the cache is dropped, so an answer to a read from before is thrown away. */
let readGeneration = 0;
let readAbort = new AbortController();
let onReadLanded: (() => void) | null = null;
let openDialog: HTMLDialogElement | null = null;
/** {@link fileData} of the source the open dialog last drew. */
let openData = '';

function forgetReads(): void {
  reads.clear();
  queue.length = 0;
  readGeneration += 1;
  readAbort.abort();
  readAbort = new AbortController();
}

function request(from: FlowHost, key: string, path: string): Read {
  const id = `${key}\u0000${path}`;
  const known = reads.get(id);
  if (known !== undefined) return known;
  const pending: Read = { state: 'pending' };
  reads.set(id, pending);
  queue.push({ key: id, path, from });
  pump();
  return pending;
}

function pump(): void {
  const limit = host === null ? 0 : openDialog === null ? host.concurrency.prefetch : host.concurrency.open;
  while (active < limit && queue.length > 0) {
    const job = queue.shift();
    if (job === undefined) return;
    active += 1;
    const generation = readGeneration;
    const signal = readAbort.signal;
    const land = (read: Read): void => {
      if (generation === readGeneration) reads.set(job.key, read);
    };
    void fetchText(job.from, job.path, signal)
      .then((text) => land(text === null ? { state: 'failed' } : { state: 'ready', imports: importSpecifiers(job.path, text) }))
      .catch(() => land({ state: 'failed' }))
      .finally(() => {
        active -= 1;
        if (generation === readGeneration) onReadLanded?.();
        pump();
      });
  }
}

/** A read that has not answered by then counts as failed: the diagram waits for every read, so one stalled download must not hold it. */
async function fetchText(from: FlowHost, path: string, signal: AbortSignal): Promise<string | null> {
  let timer = 0;
  const deadline = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), READ_TIMEOUT_MS);
  });
  try {
    const text = await Promise.race([from.read(path, signal), deadline]);
    return text === null || text.length > MAX_BYTES ? null : text;
  } finally {
    window.clearTimeout(timer);
  }
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
 * at most `FlowHost.maxReads`), and the imports the diff's removed lines name (`FlowFile.removedImports`: all of a
 * deleted file's, those a surviving file dropped). The diff is against the merge base, so a link drawn as removed
 * was there when the review branched off, not merely on the base branch's tip.
 */
function readFiles(current: FlowSource, files: readonly FlowFile[]): Reading {
  const after = new Map<string, readonly string[]>();
  const before = new Map<string, readonly string[]>();
  const readable = files.filter((file) => canReadImports(file.path));
  const deleted = new Set(files.filter((file) => file.status === 'deleted').map((file) => file.path));
  for (const file of readable) if (file.removedImports.length > 0) before.set(file.path, file.removedImports);
  const from = host;
  if (!current.headKnown || from === null) return { after, before, deleted, wanted: 0, landed: 0, unreadable: readable.some((file) => file.status !== 'deleted') };
  let wanted = 0;
  let landed = 0;
  const ordered = [...readable].sort((a, b) => Number(a.hiddenAs !== null) - Number(b.hiddenAs !== null));
  for (const file of ordered) {
    if (file.status === 'deleted' || wanted >= from.maxReads) continue;
    wanted += 1;
    const read = request(from, current.key, file.path);
    if (read.state !== 'pending') landed += 1;
    if (read.state === 'ready') after.set(file.path, read.imports);
  }
  return { after, before, deleted, wanted, landed, unreadable: false };
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

function card(file: FlowFile, host: FlowHost, onOpen: () => void): HTMLAnchorElement {
  const directory = directoryOf(file.path);
  const meta = createElement('span', { class: 'geld-flow__meta' }, [statusIcon(file.status), createElement('span', { class: 'geld-flow__status' }, [STATUS_WORD[file.status]])]);
  if (directory !== '') meta.append(createElement('span', { class: 'geld-flow__dir' }, [directory]));
  const counts = createElement('span', { class: 'geld-flow__counts' });
  if (file.additions > 0) counts.append(createElement('span', { class: 'geld-flow__add' }, [`+${formatCount(file.additions)}`]));
  if (file.deletions > 0) counts.append(createElement('span', { class: 'geld-flow__del' }, [`\u2212${formatCount(file.deletions)}`]));
  const name = createElement('span', { class: 'geld-flow__name-row' }, [createElement('span', { class: 'geld-flow__name' }, [nameOf(file.path)]), counts]);
  const label = `${STATUS_WORD[file.status]} file ${file.path}${file.hiddenAs === null ? '' : `, ${file.hiddenAs}`}. Open in ${host.filesTab}`;
  const node = createElement('a', { class: 'geld-flow__node', href: host.filesHref(), 'data-status': file.status, 'data-path': file.path, title: file.path, 'aria-label': label }, [meta, name]);
  if (file.hiddenAs !== null) {
    node.setAttribute('data-hidden', '');
    meta.append(createElement('span', { class: 'geld-flow__tag' }, [file.hiddenAs]));
  }
  void Promise.resolve(host.fileHref(file.path)).then((href) => {
    if (href !== null) node.href = href;
  });
  node.addEventListener('click', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && host.navigate?.(file.path) === true) event.preventDefault();
    onOpen();
  });
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

function drawComponent(component: FlowComponent, files: ReadonlyMap<string, FlowFile>, host: FlowHost, onOpen: () => void): HTMLElement {
  const width = Math.ceil(component.width * NODE_WIDTH) + PAD * 2;
  const height = component.rows.length * NODE_HEIGHT + (component.rows.length - 1) * ROW_GAP + PAD * 2;
  const graph = createElement('div', { class: 'geld-flow__graph', style: `width:${width}px;height:${height}px` });
  const svg = svgElement('svg', { class: 'geld-flow__links', width: String(width), height: String(height), viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  const markerId = `geld-flow-arrow-${(markers += 1)}`;
  const defs = svgElement('defs', {});
  const marker = svgElement('marker', { id: markerId, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
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
    const path = svgElement('path', { d: roundedPath(points), class: 'geld-flow__link', 'data-from': route.edge.from, 'data-to': route.edge.to, 'marker-end': `url(#${markerId})` });
    if (route.edge.removed === true) path.setAttribute('data-removed', '');
    svg.append(path);
  }
  component.rows.forEach((row, rowIndex) => {
    for (const slot of row) {
      if (slot.kind !== 'file') continue;
      const file = files.get(slot.path);
      if (file === undefined) continue;
      const node = card(file, host, onOpen);
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

/**
 * Open the Flow dialog for `review` (the host's {@link FlowHost.review}). Escape, the close button or a click on the
 * backdrop closes it, and focus goes back to `opener` when it is still in the page.
 */
export function openFlowDialog(review: string, opener: HTMLElement | null = null): void {
  const from = host;
  if (from === null || from.review !== review) return;
  countUsage('flow_opened');
  const returnTo = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const ofThisPull = (candidate: FlowSource | null): FlowSource | null => (candidate !== null && host?.review === review ? candidate : null);
  // Flow is offered before the diff has loaded: opened then, it waits, and the source arriving redraws it.
  const opened = ofThisPull(source);
  // What each render draws from: the latest source while it is still this pull request (the diff lands, a push
  // lands, or the head becomes known, while the dialog is open), else the one it opened with.
  const latest = (): FlowSource | null => ofThisPull(source) ?? opened;
  dialogIds += 1;
  const titleId = `geld-flow-${dialogIds}-title`;
  const dialog = createElement('dialog', { class: `Overlay Overlay--motion-scaleFade geld-flow ${from.skin.dialog ?? ''}`.trim(), 'data-skin': from.skin.name, [OWN_UI_ATTRIBUTE]: '', 'aria-labelledby': titleId });
  const close = createElement('button', { type: 'button', class: `${from.skin.closeButton} Overlay-closeButton`, 'aria-label': 'Close' }, [icon(ICON_X)]);
  let showHidden = false;
  const toggle = createElement('button', { type: 'button', class: `${from.skin.button} geld-flow__toggle`, 'aria-pressed': String(showHidden) });
  const actions = createElement('div', { class: 'Overlay-actionWrap geld-flow__actions' }, [toggle, close]);

  // The diagram scrolls inside the stage; the controls (the legend, then zoom) float over its lower right corner and stay put.
  const scroller = createElement('div', { class: 'geld-flow__scroll' });
  const canvas = createElement('div', { class: 'geld-flow__canvas' });
  scroller.append(canvas);
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
  const body = createElement('div', { class: 'Overlay-body geld-flow__stage' }, [scroller, controls]);
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
    /** Said in the diagram's place: nothing is drawn until it can be drawn whole, so the layout never shifts under the reader. */
    const message = (text: string, role: 'status' | 'alert', action: HTMLElement | null = null): void => {
      controls.hidden = true;
      canvas.replaceChildren(createElement('div', { class: 'geld-flow__message', role }, [createElement('p', {}, [text]), ...(action === null ? [] : [action])]));
    };
    if (current === null) {
      toggle.hidden = true;
      const failed = failure !== null && failure.review === review ? failure : null;
      if (failed === null) return message(`Waiting for the ${from.reviewNoun}\u2019s diff…`, 'status');
      const reload = createElement('button', { type: 'button', class: from.skin.button }, ['Reload']);
      reload.addEventListener('click', () => location.reload());
      // A failure still being retried is routine and announced politely. Only one Flow has given up on interrupts.
      return message(failed.text, failed.retrying ? 'status' : 'alert', failed.reload ? reload : null);
    }
    const essentialNow = current.files.filter((file) => file.hiddenAs === null).length;
    const hiddenNow = current.files.length - essentialNow;
    // Offered from the counts as they are now: the diff landing (or the settings changing) can hide files that the
    // summaries the dialog opened with did not.
    toggle.hidden = hiddenNow === 0 || essentialNow === 0;
    // With every file hidden there is nothing essential to show, so all of them are.
    const files = current.files.filter((file) => showHidden || essentialNow === 0 || file.hiddenAs === null);
    toggle.textContent = showHidden ? `Hide ${plural(hiddenNow, 'hidden file')}` : `Show ${plural(hiddenNow, 'hidden file')}`;
    toggle.setAttribute('aria-pressed', String(showHidden));
    const reading = readFiles(current, files);
    if (reading.landed < reading.wanted) return message(`Reading ${formatCount(reading.landed)} of ${plural(reading.wanted, 'file')}…`, 'status');
    controls.hidden = false;
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
    const scrollTop = scroller.scrollTop;
    const scrollLeft = scroller.scrollLeft;
    canvas.replaceChildren();
    for (const component of layout.components) canvas.append(drawComponent(component, byPath, from, dismiss));
    if (layout.loose.length > 0) {
      const section = createElement('section', { class: 'geld-flow__loose' }, [createElement('h2', { class: 'geld-flow__loose-title' }, [layout.components.length === 0 ? 'Changed files' : 'Not linked to other changes'])]);
      const grid = createElement('div', { class: 'geld-flow__loose-grid' });
      for (const path of layout.loose) {
        const file = byPath.get(path);
        if (file !== undefined) grid.append(card(file, from, dismiss));
      }
      section.append(grid);
      canvas.append(section);
    }
    if (current.removed !== 'known') canvas.prepend(createElement('p', { class: 'geld-flow__note' }, [REMOVED_NOTE[current.removed]]));
    for (const note of [...(current.notes ?? [])].reverse()) canvas.prepend(createElement('p', { class: 'geld-flow__note' }, [note]));
    if (reading.unreadable) canvas.prepend(createElement('p', { class: 'geld-flow__note' }, ['Geld could not tell which commit this page shows, so it drew the files without their links.']));
    scroller.scrollTop = scrollTop;
    scroller.scrollLeft = scrollLeft;
    // Fitted on the first draw (and after the toggle); the reader's own zoom stays through later redraws.
    if (!fitted) {
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
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  // A host's own shortcuts can swallow the browser's Escape: the dialog closes on it first.
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    },
    { capture: true },
  );
  dialog.addEventListener('close', () => {
    if (openDialog === dialog) {
      openDialog = null;
      onReadLanded = null;
    }
    window.clearTimeout(timer);
    dialog.remove();
    if (returnTo?.isConnected === true) returnTo.focus({ preventScroll: true });
  });
  openDialog?.close();
  openDialog = dialog;
  // Reads still queued from the background go at full speed now that someone is waiting on them.
  pump();
  openData = opened === null ? '' : fileData(opened);
  document.body.append(dialog);
  dialog.showModal();
  applyScale(1);
  render();
  close.focus();
}
