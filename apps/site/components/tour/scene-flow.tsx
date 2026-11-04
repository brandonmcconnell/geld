'use client';

import { createMatcher, DEFAULT_SETTINGS, formatCount } from '@geld/core';
import type { FlowComponent, FlowRoute } from '@geld/core/file-flow';
import { flowLinks, layoutFlow } from '@geld/core/file-flow';
import { cn } from 'cn';
import { WorkflowIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { GeldRowTools, Meter } from '@/components/tour/bits';
import type { TourFile } from '@/components/tour/data';
import { TOUR_FILES } from '@/components/tour/data';
import { Octicon } from '@/components/tour/octicons';
import { Ping } from '@/components/tour/ping';
import type { PrTab } from '@/components/tour/pr-window';
import { PrWindow } from '@/components/tour/pr-window';
import { Switch } from '@/components/ui/switch';

/** What each of the tour's files imports now, and (for `src/index.ts`) what it imported before: it no longer reaches `useToggle` itself. */
const AFTER: ReadonlyMap<string, readonly string[]> = new Map([
  ['src/index.ts', ['./Button']],
  ['src/Button.tsx', ['./hooks/useToggle']],
  ['src/hooks/useToggle.ts', []],
  ['src/Button.test.tsx', ['./Button']],
  ['src/hooks/useToggle.test.ts', ['./useToggle']],
  ['e2e/button.cy.ts', []],
]);
const BEFORE: ReadonlyMap<string, readonly string[]> = new Map([['src/index.ts', ['./Button', './hooks/useToggle']]]);

// The extension's drawing (apps/extension/src/github/review/flow.ts), with smaller cards so a diagram fits the tour's window.
const NODE_WIDTH = 168;
const NODE_HEIGHT = 46;
const ROW_GAP = 34;
const PAD = 14;
const PORT_SPREAD = 10;
const CORNER = 8;

const SUMMARY: readonly (readonly [string, string])[] = [
  ['Reviews', '1/2 approvals · mona approved'],
  ['Review bots', 'Buggy 1 issue · CodeHopper resolved · Gecko 5/5'],
  ['CI checks', '18 successful checks'],
];

interface FlowFile extends TourFile {
  readonly hiddenAs: string | null;
}

export function FlowScene() {
  const [tab, setTab] = useState<PrTab>('conversation');
  const [flowOpen, setFlowOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const files = useMemo<readonly FlowFile[]>(() => {
    const matcher = createMatcher(DEFAULT_SETTINGS);
    return TOUR_FILES.map((file) => ({ ...file, hiddenAs: matcher.categorize(file.path)?.title ?? null }));
  }, []);
  const byPath = new Map(files.filter((file) => showHidden || file.hiddenAs === null).map((file) => [file.path, file]));
  const layout = useMemo(() => {
    const paths = files.filter((file) => showHidden || file.hiddenAs === null).map((file) => file.path);
    return layoutFlow(paths, flowLinks(paths, AFTER, BEFORE));
  }, [files, showHidden]);

  const flowButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (flowOpen) dialog.current?.focus({ preventScroll: true });
  }, [flowOpen]);

  const dismiss = (): void => {
    setFlowOpen(false);
    setLit(null);
    flowButton.current?.focus({ preventScroll: true });
  };
  const open = (path: string): void => {
    setOpened(path);
    setFlowOpen(false);
    setLit(null);
    setTab('files');
  };

  return (
    <PrWindow tab={tab} onTab={setTab} disabledTabs={['commits', 'checks']} filesCount={files.filter((file) => file.hiddenAs === null).length} bodyClassName="relative min-h-[26rem]">
      {tab === 'files' ? (
        <FilesView files={files.filter((file) => showHidden || file.hiddenAs === null)} opened={opened} />
      ) : (
        <div className="m-3 rounded-lg border text-xs">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="font-semibold">Geld</span>
            <Meter done={3} total={5} />
            <span className="min-w-0 truncate text-muted-foreground tabular-nums">3/5 resolved</span>
            <GeldRowTools>
              <Ping on={!flowOpen} className="inline-flex rounded-md">
                <button
                  ref={flowButton}
                  type="button"
                  aria-label="Flow: how the changed files connect"
                  aria-expanded={flowOpen}
                  title="How the changed files connect"
                  onClick={() => (flowOpen ? dismiss() : setFlowOpen(true))}
                  className={cn('inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-medium outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60', flowOpen && 'bg-muted text-foreground')}
                >
                  <WorkflowIcon aria-hidden="true" className="size-3.5" />
                  <span className="@max-[26rem]:hidden">Flow</span>
                </button>
              </Ping>
            </GeldRowTools>
          </div>
          {SUMMARY.map(([label, text]) => (
            <div key={label} className="flex items-center gap-3 border-t px-3 py-1.5">
              <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
              <span className="min-w-0 truncate">{text}</span>
            </div>
          ))}
        </div>
      )}

      <div
        ref={dialog}
        role="dialog"
        aria-label="Flow"
        tabIndex={-1}
        inert={!flowOpen}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dismiss();
        }}
        className={cn(
          'absolute inset-x-2 top-2 z-10 flex outline-none max-h-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-xl transition-[opacity,transform] duration-200',
          flowOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
        )}
      >
        <div className="relative flex h-10 shrink-0 items-center justify-center gap-1.5 border-b bg-muted/40 px-3 text-xs">
          <WorkflowIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="font-semibold">Flow</span>
          <span className="absolute right-2 flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="@max-lg:sr-only">Hidden files</span>
              <Switch checked={showHidden} onCheckedChange={setShowHidden} aria-label="Show the files your settings hide" />
            </label>
            <button type="button" aria-label="Close" onClick={dismiss} className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        </div>
        <div className="flex flex-col gap-3 p-3">
          {layout.components.map((component, index) => (
            <Graph key={index} component={component} files={byPath} lit={lit} onLight={setLit} onOpen={open} />
          ))}
          {layout.loose.length > 0 ? (
            <section aria-label="Not linked to other changes">
              <p className="mb-1.5 text-[0.6875rem] font-medium text-muted-foreground">Not linked to other changes</p>
              <ul className="flex flex-wrap gap-1.5">
                {layout.loose.map((path) => {
                  const file = byPath.get(path);
                  return file ? (
                    <li key={path}>
                      <button
                        type="button"
                        onClick={() => open(path)}
                        className={cn('inline-flex h-6 items-center gap-1.5 rounded-md border bg-card px-2 font-mono text-[0.6875rem] outline-none hover:border-[#0969da] focus-visible:ring-2 focus-visible:ring-ring/60', file.hiddenAs !== null && 'border-dashed')}
                      >
                        <Octicon glyph="file-diff" className="size-3 text-muted-foreground" />
                        {nameOf(path)}
                      </button>
                    </li>
                  ) : null;
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </PrWindow>
  );
}

/** One connected group of files, drawn as the extension draws it and scaled down when the window is narrower. */
function Graph({
  component,
  files,
  lit,
  onLight,
  onOpen,
}: {
  readonly component: FlowComponent;
  readonly files: ReadonlyMap<string, FlowFile>;
  readonly lit: string | null;
  readonly onLight: (path: string | null) => void;
  readonly onOpen: (path: string) => void;
}) {
  const width = Math.ceil(component.width * NODE_WIDTH) + PAD * 2;
  const height = component.rows.length * NODE_HEIGHT + (component.rows.length - 1) * ROW_GAP + PAD * 2;
  const frame = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  // Every scene is rendered twice (stage and inline), so the arrows' markers need ids of their own.
  const arrow = `tour-flow-arrow-${useId().replace(/[^\w-]/g, '')}`;
  useLayoutEffect(() => {
    const node = frame.current;
    if (node === null) return;
    const fit = (): void => setScale(Math.min(1, node.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);

  const rowTop = (row: number): number => PAD + row * (NODE_HEIGHT + ROW_GAP);
  const px = (x: number): number => PAD + x * NODE_WIDTH;
  const offsets = ports(component);

  return (
    <div ref={frame} className="w-full" style={{ height: height * scale }}>
      <div className="relative mx-auto origin-top-left" style={{ width, height, transform: `scale(${scale})` }} onPointerLeave={() => onLight(null)}>
        <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0">
          <defs>
            <marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0.5 L7.5,4 L0,7.5 Z" className="fill-muted-foreground/60" />
            </marker>
            <marker id={`${arrow}-lit`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0.5 L7.5,4 L0,7.5 Z" className="fill-[#0969da] dark:fill-[#4493f8]" />
            </marker>
          </defs>
          {component.routes.map((route) => {
            const on = lit !== null && (route.edge.from === lit || route.edge.to === lit);
            return (
              <path
                key={`${route.edge.from}>${route.edge.to}`}
                d={roundedPath(routePoints(route, offsets.get(route) ?? { start: 0, end: 0 }, rowTop, px))}
                markerEnd={`url(#${on ? `${arrow}-lit` : arrow})`}
                strokeDasharray={route.edge.removed ? '4 4' : undefined}
                className={cn(
                  'fill-none stroke-[1.5] transition-[opacity,stroke] duration-150',
                  route.edge.removed ? 'stroke-deletion' : on ? 'stroke-[#0969da] dark:stroke-[#4493f8]' : 'stroke-muted-foreground/60',
                  lit !== null && !on && 'opacity-20',
                )}
              />
            );
          })}
        </svg>
        {component.rows.flatMap((row, rowIndex) =>
          row.map((slot) => {
            if (slot.kind !== 'file') return null;
            const file = files.get(slot.path);
            if (file === undefined) return null;
            return <Card key={slot.path} file={file} left={px(slot.x) - NODE_WIDTH / 2} top={rowTop(rowIndex)} onLight={onLight} onOpen={onOpen} />;
          }),
        )}
      </div>
    </div>
  );
}

function Card({ file, left, top, onLight, onOpen }: { readonly file: FlowFile; readonly left: number; readonly top: number; readonly onLight: (path: string) => void; readonly onOpen: (path: string) => void }) {
  const directory = directoryOf(file.path);
  return (
    <button
      type="button"
      title={file.path}
      aria-label={`Changed file ${file.path}${file.hiddenAs === null ? '' : `, ${file.hiddenAs}`}. Open in Files changed`}
      onPointerEnter={() => onLight(file.path)}
      onFocus={() => onLight(file.path)}
      onClick={() => onOpen(file.path)}
      className={cn(
        'absolute flex flex-col justify-center gap-0.5 rounded-md border bg-card px-2.5 text-left outline-none transition-[border-color,box-shadow] hover:border-[#0969da] hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60 dark:hover:border-[#4493f8]',
        file.hiddenAs !== null && 'border-dashed',
      )}
      style={{ left, top, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span className="flex min-w-0 items-center gap-1 text-[0.625rem] leading-3 text-muted-foreground">
        <Octicon glyph="file-diff" className="size-3" />
        <span className="shrink-0">Changed</span>
        {directory === '' ? null : <span className="min-w-0 truncate">{directory}</span>}
        {file.hiddenAs === null ? null : <span className="ml-auto shrink-0 rounded-full border px-1.5 text-[0.5625rem]">{file.hiddenAs}</span>}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] font-semibold">{nameOf(file.path)}</span>
        <span className="shrink-0 font-mono text-[0.625rem] tabular-nums">
          <span className="text-addition">+{formatCount(file.additions)}</span> <span className="text-deletion">&minus;{formatCount(file.deletions)}</span>
        </span>
      </span>
    </button>
  );
}

function FilesView({ files, opened }: { readonly files: readonly FlowFile[]; readonly opened: string | null }) {
  const target = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    target.current?.focus({ preventScroll: true });
  }, [opened]);
  return (
    <ul aria-label="Files changed" className="py-1">
      {files.map((file) => (
        <li
          key={file.path}
          ref={file.path === opened ? target : undefined}
          tabIndex={file.path === opened ? -1 : undefined}
          className={cn('mx-3 my-1 flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-xs outline-none transition-colors', file.hiddenAs !== null && 'border-dashed', file.path === opened ? 'border-[#0969da] bg-[#0969da]/8 dark:border-[#4493f8] dark:bg-[#4493f8]/10' : 'border-transparent')}
        >
          <Octicon glyph="file-diff" className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">{directoryOf(file.path)}</span>
            {nameOf(file.path)}
          </span>
          {file.hiddenAs === null ? null : <span className="shrink-0 rounded-full border px-1.5 font-sans text-[0.625rem] text-muted-foreground">{file.hiddenAs}</span>}
          <span className="shrink-0 tabular-nums">
            <span className="text-addition">+{formatCount(file.additions)}</span> <span className="text-deletion">&minus;{formatCount(file.deletions)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The file's folder by its nearest two levels, as the extension's cards show it. */
function directoryOf(path: string): string {
  const parts = path.split('/').slice(0, -1);
  if (parts.length === 0) return '';
  return parts.length > 2 ? `\u2026/${parts.slice(-2).join('/')}/` : `${parts.join('/')}/`;
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
      const current = offsets.get(entry.route) ?? { start: 0, end: 0 };
      current[entry.end] = (index - (list.length - 1) / 2) * spread;
      offsets.set(entry.route, current);
    });
  }
  return offsets;
}

/** A link's corners: out of the importer's edge, across between rows, straight through any bend point's row, into the import. */
function routePoints(route: FlowRoute, offset: { readonly start: number; readonly end: number }, rowTop: (row: number) => number, px: (x: number) => number): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
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
  return points;
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
    const start = [corner[0] - ((corner[0] - previous[0]) / inLength) * radius, corner[1] - ((corner[1] - previous[1]) / inLength) * radius];
    const end = [corner[0] + ((next[0] - corner[0]) / outLength) * radius, corner[1] + ((next[1] - corner[1]) / outLength) * radius];
    d += ` L${start[0]},${start[1]} Q${corner[0]},${corner[1]} ${end[0]},${end[1]}`;
  }
  const last = points[points.length - 1];
  if (last !== undefined && points.length > 1) d += ` L${last[0]},${last[1]}`;
  return d;
}
