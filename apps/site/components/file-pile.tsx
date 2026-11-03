'use client';

import type { CategoryId, HiddenCategory } from '@geld/core';
import { createMatcher, DEFAULT_SETTINGS, formatCount } from '@geld/core';
import { cn } from 'cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '@/components/use-media-query';
import type { Body, Rect, World } from '@/lib/pile-physics';
import { seeded, settled, step, wake } from '@/lib/pile-physics';

interface PileFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** A pull request's files, in the order they fall. The matcher decides which are noise. */
const FILES: readonly PileFile[] = [
  { path: 'pnpm-lock.yaml', additions: 1204, deletions: 811 },
  { path: 'src/Button.test.tsx', additions: 38, deletions: 12 },
  { path: 'src/Button.tsx', additions: 18, deletions: 9 },
  { path: 'README.md', additions: 3, deletions: 2 },
  { path: 'src/__snapshots__/Button.test.tsx.snap', additions: 6, deletions: 8 },
  { path: 'e2e/button.cy.ts', additions: 7, deletions: 3 },
  { path: 'src/api/__generated__/schema.ts', additions: 64, deletions: 20 },
  { path: 'src/hooks/useToggle.ts', additions: 8, deletions: 7 },
  { path: '.github/workflows/ci.yml', additions: 3, deletions: 1 },
  { path: 'src/Switch.test.tsx', additions: 22, deletions: 4 },
  { path: 'CHANGELOG.md', additions: 4, deletions: 0 },
  { path: 'dist/index.d.ts', additions: 41, deletions: 17 },
  { path: 'src/Switch.tsx', additions: 9, deletions: 2 },
  { path: 'src/hooks/useToggle.test.ts', additions: 11, deletions: 5 },
  { path: 'docs/button.mdx', additions: 22, deletions: 4 },
  { path: 'tsconfig.json', additions: 2, deletions: 1 },
  { path: 'e2e/switch.cy.ts', additions: 6, deletions: 2 },
  { path: 'src/index.ts', additions: 2, deletions: 1 },
  { path: 'src/api/__generated__/client.ts', additions: 88, deletions: 31 },
  { path: 'src/__snapshots__/Switch.test.tsx.snap', additions: 5, deletions: 5 },
  { path: 'docs/switch.mdx', additions: 14, deletions: 0 },
  { path: '.eslintrc.json', additions: 3, deletions: 3 },
  { path: 'test/setup.ts', additions: 4, deletions: 1 },
  { path: 'src/types.ts', additions: 5, deletions: 3 },
  { path: 'vitest.config.ts', additions: 2, deletions: 0 },
  { path: 'src/__tests__/a11y.test.tsx', additions: 9, deletions: 4 },
  { path: 'biome.json', additions: 1, deletions: 1 },
  { path: 'src/theme/tokens.ts', additions: 12, deletions: 4 },
  { path: '.prettierrc', additions: 1, deletions: 1 },
];

const HIDDEN: readonly CategoryId[] = ['tests', 'generated', 'docs', 'tooling'];

const DOT: Record<string, string> = {
  tests: 'bg-[oklch(0.75_0.15_75)]',
  generated: 'bg-[oklch(0.65_0.03_260)]',
  docs: 'bg-[oklch(0.68_0.13_235)]',
  tooling: 'bg-[oklch(0.62_0.16_300)]',
};

/** Seconds after the pile lands before Geld switches itself on, unless the reader has already played. */
const AUTO_GELD_AFTER = 1.4;
const CHIP_GAP = 30;

interface Classified extends PileFile {
  readonly category: HiddenCategory | null;
}

interface Layout {
  readonly world: World;
  /** Anchored by its right edge, so the count changing its width never moves it. */
  readonly pill: { readonly right: number; readonly top: number };
}

/**
 * The hero's file pile: a pull request's files rain into the space around the
 * hero's words and pile up, then Geld swallows the noise into its switch and
 * leaves the files worth reviewing. Every file can be dragged and thrown, and
 * the switch turns Geld off and on. Lives on a layer over the hero that takes
 * no room, with the hero's words as obstacles; with reduced motion there is no
 * pile at all.
 */
export function FilePile() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const files = useMemo<readonly Classified[]>(() => {
    const matcher = createMatcher({ ...DEFAULT_SETTINGS, categories: Object.fromEntries(HIDDEN.map((id) => [id, true])) });
    return FILES.map((file) => ({ ...file, category: matcher.categorize(file.path) }));
  }, []);

  const layer = useRef<HTMLDivElement | null>(null);
  const pill = useRef<HTMLButtonElement | null>(null);
  const chips = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  /** The files in play: as many as the free space holds, the ones that matter first. */
  const kept = useRef<ReadonlySet<number>>(new Set());
  const world = useRef<World | null>(null);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const interacted = useRef(false);
  const landedAt = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const drag = useRef<{ index: number; dx: number; dy: number; x: number; y: number; t: number; vx: number; vy: number } | null>(null);

  const [geld, setGeld] = useState(false);
  const [shown, setShown] = useState(0);
  const [hidden, setHidden] = useState(0);
  const [pillAt, setPillAt] = useState<Layout['pill'] | null>(null);

  const paint = useCallback(() => {
    bodies.current.forEach((body, index) => {
      const el = chips.current[index];
      if (!el) return;
      if (body.mode === 'hidden') {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      el.style.opacity = body.mode === 'absorbing' ? String(Math.min(1, (body.scale - 0.25) / 0.5)) : '1';
      el.style.transform = `translate3d(${body.x - body.w / 2}px, ${body.y - body.h / 2}px, 0) scale(${body.scale})`;
    });
    setHidden(bodies.current.filter((body, index) => body.mode === 'hidden' && kept.current.has(index)).length);
  }, []);

  const run = useCallback(() => {
    if (frame.current !== null) return;
    last.current = performance.now();
    const loop = (now: number): void => {
      frame.current = null;
      const current = world.current;
      if (current === null) return;
      const dt = Math.min(1 / 30, (now - last.current) / 1000);
      last.current = now;
      step(bodies.current, current, dt);
      paint();
      // Landed: at rest, or long enough after the drop that the reader has seen the pile.
      const since = startedAt.current === null ? 0 : now - startedAt.current;
      if (landedAt.current === null && (settled(bodies.current) || since > 2500)) landedAt.current = now;
      if (!settled(bodies.current) || drag.current !== null) frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
  }, [paint]);

  const measure = useCallback((): Layout | null => {
    const root = layer.current;
    const hero = root?.parentElement?.querySelector<HTMLElement>('[data-pile-hero]');
    const reel = root?.parentElement?.querySelector<HTMLElement>('#customers-heading');
    if (!root || !hero || !reel) return null;
    const origin = root.getBoundingClientRect();
    const relative = (r: DOMRect, pad = 4): Rect => ({ left: r.left - origin.left - pad, top: r.top - origin.top - pad, right: r.right - origin.left + pad, bottom: r.bottom - origin.top + pad });
    const obstacles: Rect[] = [];
    for (const el of hero.querySelectorAll<HTMLElement>('#hero-wordmark, h1 span, p, a')) {
      if (!el.checkVisibility()) continue;
      if (el.tagName === 'A' || el.id === 'hero-wordmark') {
        obstacles.push(relative(el.getBoundingClientRect()));
        continue;
      }
      // Text is as wide as its words, not its box, so files can rest beside a short line.
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) obstacles.push(relative(r));
    }
    // Fill gaps a file could wedge into between lines.
    for (const upper of obstacles) {
      for (const lower of obstacles) {
        const gap = lower.top - upper.bottom;
        const across = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
        if (gap > 0 && gap < CHIP_GAP && across > 0) Object.assign(upper, { bottom: lower.top });
      }
    }
    const floor = reel.getBoundingClientRect().top - origin.top - 8;
    const heroBox = hero.getBoundingClientRect();
    const padRight = parseFloat(getComputedStyle(hero).paddingRight);
    const button = pill.current;
    const pw = button?.offsetWidth ?? 150;
    const ph = button?.offsetHeight ?? 32;
    const pillRight = heroBox.right - origin.left - padRight;
    const pillTop = floor - ph;
    obstacles.push({ left: pillRight - pw - 4, top: pillTop - 4, right: pillRight + 4, bottom: floor + 8 });
    return { world: { width: origin.width, floor, obstacles, sink: { x: pillRight - pw / 2, y: pillTop + ph / 2 } }, pill: { right: origin.width - pillRight, top: pillTop } };
  }, []);

  // Lay the world out, drop the files once the pile is in view, and keep up with resizes.
  useEffect(() => {
    if (reduced) return;
    const root = layer.current;
    if (!root) return;
    let started = false;
    let visible = false;

    const layout = (): void => {
      const next = measure();
      if (next === null) return;
      world.current = next.world;
      setPillAt(next.pill);
      if (bodies.current.length > 0) {
        wake(bodies.current);
        run();
      }
    };

    const start = (): void => {
      const current = world.current;
      if (started || current === null) return;
      started = true;
      startedAt.current = performance.now();
      const sizes = chips.current.map((el) => ({ w: el?.offsetWidth ?? 120, h: el?.offsetHeight ?? 24 }));
      // Rain into the free columns beside the hero's words; with none (a phone), drop into the band between the words and the floor.
      const words = current.obstacles.slice(0, -1);
      const textLeft = Math.min(...words.map((r) => r.left));
      const textRight = Math.max(...words.map((r) => r.right));
      const textBottom = Math.max(...words.map((r) => r.bottom));
      const columns = [
        { left: 0, right: textLeft - 8 },
        { left: textRight + 8, right: current.width },
      ].filter((column) => column.right - column.left > 140);
      const columnWidth = columns.reduce((sum, column) => sum + column.right - column.left, 0);
      const useColumns = columnWidth > current.width * 0.25;
      const freeArea = useColumns ? columnWidth * current.floor : current.width * Math.max(0, current.floor - textBottom);
      const average = sizes.reduce((sum, size) => sum + size.w * size.h, 0) / Math.max(1, sizes.length);
      const room = Math.max(8, Math.floor((freeArea * 0.34) / average));
      const keep = new Set<number>();
      files.forEach((file, index) => {
        if (file.category === null) keep.add(index);
      });
      files.forEach((file, index) => {
        if (file.category !== null && keep.size < room) keep.add(index);
      });
      const order = [...keep];
      const random = seeded(17);
      bodies.current = files.map((_, index) => {
        const size = sizes[index] ?? { w: 120, h: 24 };
        const place = order.indexOf(index);
        const fits = columns.filter((column) => column.right - column.left >= size.w + 4);
        let x = size.w / 2 + random() * Math.max(1, current.width - size.w);
        let y = -size.h - place * 24 - random() * 40;
        if (useColumns && fits.length > 0) {
          const total = fits.reduce((sum, column) => sum + column.right - column.left - size.w, 0);
          let pick = random() * total;
          for (const column of fits) {
            const span = column.right - column.left - size.w;
            if (pick <= span) {
              x = column.left + size.w / 2 + pick;
              break;
            }
            pick -= span;
          }
        } else if (!useColumns) {
          y = textBottom - size.h - place * 6 - random() * 20;
        }
        return {
          x,
          y,
          vx: (random() - 0.5) * 120,
          vy: 200 + random() * 300,
          w: size.w,
          h: size.h,
          scale: 1,
          mode: keep.has(index) ? 'free' : 'hidden',
          held: false,
          still: 0,
        };
      });
      kept.current = keep;
      setShown(keep.size);
      paint();
      run();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) {
        start();
        run();
      } else if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    });
    const resize = new ResizeObserver(layout);

    void document.fonts.ready.then(() => {
      layout();
      observer.observe(root);
      if (root.parentElement) resize.observe(root.parentElement);
    });
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [reduced, measure, run, paint, files]);

  // Geld switches itself on a moment after the pile lands, unless the reader got there first.
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      const at = landedAt.current;
      if (at === null || interacted.current) return;
      if (performance.now() - at > AUTO_GELD_AFTER * 1000) {
        window.clearInterval(timer);
        setGeld(true);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [reduced]);

  // Geld on: the noise is drawn into the switch one after another. Off: it bursts back out.
  useEffect(() => {
    const current = world.current;
    if (current === null || bodies.current.length === 0) return;
    const random = seeded(geld ? 3 : 5);
    const timers: number[] = [];
    let delay = 0;
    bodies.current.forEach((body, index) => {
      if (files[index]?.category === null || !kept.current.has(index)) return;
      if (geld && body.mode === 'free') {
        timers.push(window.setTimeout(() => {
          body.mode = 'absorbing';
          body.held = false;
          run();
        }, delay));
        delay += 45;
      } else if (!geld && body.mode !== 'free') {
        timers.push(window.setTimeout(() => {
          body.mode = 'free';
          body.x = current.sink.x;
          body.y = current.sink.y - 30;
          body.vx = (random() - 0.5) * 1400;
          body.vy = -900 - random() * 700;
          body.still = 0;
          run();
        }, delay));
        delay += 35;
      }
    });
    wake(bodies.current);
    run();
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [geld, files, run]);

  const onPointerDown = (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodies.current[index];
    if (!body || body.mode !== 'free') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interacted.current = true;
    const origin = layer.current?.getBoundingClientRect();
    const x = event.clientX - (origin?.left ?? 0);
    const y = event.clientY - (origin?.top ?? 0);
    body.held = true;
    body.still = 0;
    drag.current = { index, dx: body.x - x, dy: body.y - y, x, y, t: performance.now(), vx: 0, vy: 0 };
    run();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    const body = bodies.current[held.index];
    if (!body) return;
    const origin = layer.current?.getBoundingClientRect();
    const x = event.clientX - (origin?.left ?? 0);
    const y = event.clientY - (origin?.top ?? 0);
    const now = performance.now();
    const elapsed = Math.max(1, now - held.t) / 1000;
    held.vx = held.vx * 0.6 + ((x - held.x) / elapsed) * 0.4;
    held.vy = held.vy * 0.6 + ((y - held.y) / elapsed) * 0.4;
    held.x = x;
    held.y = y;
    held.t = now;
    body.x = x + held.dx;
    body.y = y + held.dy;
    run();
  };

  const onPointerUp = () => {
    const held = drag.current;
    if (!held) return;
    const body = bodies.current[held.index];
    if (body) {
      body.held = false;
      body.vx = Math.max(-2400, Math.min(2400, held.vx));
      body.vy = Math.max(-2400, Math.min(2400, held.vy));
      body.still = 0;
    }
    drag.current = null;
    run();
  };

  if (reduced) return null;

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-10 [overflow-x:clip]">
      <div aria-hidden="true">
        {files.map((file, index) => (
          <div
            key={file.path}
            ref={(el) => {
              chips.current[index] = el;
            }}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ visibility: 'hidden' }}
            className={cn(
              'pointer-events-auto absolute top-0 left-0 inline-flex h-6 origin-center cursor-grab touch-none items-center gap-1.5 rounded-md border bg-card px-2 font-mono text-[0.6875rem] whitespace-nowrap shadow-sm select-none will-change-transform active:cursor-grabbing',
              file.category === null && 'border-foreground/25',
            )}
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', file.category === null ? 'bg-addition' : (DOT[file.category.id] ?? 'bg-muted-foreground'))} />
            <span>{file.path}</span>
            <span className="text-addition">+{formatCount(file.additions)}</span>
            <span className="-ml-1 text-deletion">&minus;{formatCount(file.deletions)}</span>
          </div>
        ))}
      </div>
      <button
        ref={pill}
        type="button"
        aria-pressed={geld}
        onClick={() => {
          interacted.current = true;
          setGeld((value) => !value);
        }}
        style={pillAt === null ? { visibility: 'hidden' } : { right: pillAt.right, top: pillAt.top }}
        className="geld-corners geld-cut-[7px] pointer-events-auto absolute inline-flex h-8 items-center gap-2 border bg-card px-3 text-xs font-medium shadow-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span>Geld</span>
        <span aria-hidden="true" className={cn('relative h-4 w-7 border transition-colors', geld ? 'border-transparent bg-foreground' : 'bg-input/40')}>
          <span className={cn('absolute top-[3px] size-2 transition-transform', geld ? 'translate-x-[15px] bg-background' : 'translate-x-[3px] bg-foreground')} />
        </span>
        <span className="min-w-[8.5ch] text-left text-muted-foreground tabular-nums" aria-live="polite">
          {geld ? `${hidden} hidden` : `${shown} files`}
        </span>
      </button>
    </div>
  );
}
