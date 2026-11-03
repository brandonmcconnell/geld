'use client';

import { cn } from 'cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '@/components/use-media-query';
import type { Body, Rect, World } from '@/lib/pile-physics';
import { seeded, settled, step, wake } from '@/lib/pile-physics';
import type { DigestRow } from '@/lib/pile-items';
import { DIGEST_ROWS, digestOf, PILE_ITEMS, rowOf } from '@/lib/pile-items';

import { DigestCard } from './digest-card';
import { PileCard } from './pile-card';

/** Seconds after the pile lands before Geld switches itself on, unless the reader has already played. */
const AUTO_GELD_AFTER = 2.4;
/** Gaps between lines of the hero's words narrower than this are filled, so no card wedges into one. */
const LINE_GAP = 44;
const CARD_WIDTH = 360;
const ROW_HEIGHT = 50;
const CARD_CHROME = 48;
const CHIP_LINE = 34;

interface Layout {
  readonly world: World;
  readonly height: number;
  /** Anchored by its right edge, so the label changing never moves it. */
  readonly toggle: { readonly right: number; readonly top: number };
  readonly card: { readonly width: number; readonly maxHeight: number };
  readonly words: Rect;
}

/**
 * The hero's pile: everything a pull request asks of its reviewer at once
 * (files, comments, bot notes, an agent's score, checks, previews, reports,
 * verdicts) rains into the space around the hero's words. Turning Geld on
 * gathers each into its line of a digest card that fills in as they land;
 * off, they burst back out. Every card can be dragged and thrown. Lives on a
 * layer over the hero that takes no room, with the hero's words as obstacles;
 * with reduced motion there is no pile at all.
 */
export function HeroPile() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const layer = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<DigestRow, HTMLElement>());
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  /** The items in play: as many as the free space holds, in the order they fall. */
  const kept = useRef<ReadonlySet<number>>(new Set());
  const world = useRef<World | null>(null);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const interacted = useRef(false);
  const landedAt = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const drag = useRef<{ index: number; dx: number; dy: number; x: number; y: number; t: number; vx: number; vy: number } | null>(null);

  const [geld, setGeld] = useState(false);
  const [used, setUsed] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [inPlay, setInPlay] = useState<readonly number[]>([]);
  const [gathered, setGathered] = useState('');

  const rowRef = useCallback(
    (row: DigestRow) => (el: HTMLElement | null) => {
      if (el) rowEls.current.set(row, el);
      else rowEls.current.delete(row);
    },
    [],
  );

  const paint = useCallback(() => {
    const hidden: number[] = [];
    bodies.current.forEach((body, index) => {
      const el = els.current[index];
      if (!el) return;
      if (body.mode === 'hidden') {
        el.style.visibility = 'hidden';
        if (kept.current.has(index)) hidden.push(index);
        return;
      }
      el.style.visibility = 'visible';
      el.style.opacity = body.mode === 'absorbing' ? String(Math.min(1, (body.scale - 0.25) / 0.5)) : '1';
      el.style.transform = `translate3d(${body.x - body.w / 2}px, ${body.y - body.h / 2}px, 0) scale(${body.scale})`;
    });
    const signature = hidden.join(',');
    setGathered((previous) => (previous === signature ? previous : signature));
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
      if (landedAt.current === null && (settled(bodies.current) || since > 3000)) landedAt.current = now;
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
      // Text is as wide as its words, not its box, so cards can rest beside a short line.
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) obstacles.push(relative(r));
    }
    if (obstacles.length === 0) return null;
    for (const upper of obstacles) {
      for (const lower of obstacles) {
        const gap = lower.top - upper.bottom;
        const across = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
        if (gap > 0 && gap < LINE_GAP && across > 0) Object.assign(upper, { bottom: lower.top });
      }
    }
    const words: Rect = {
      left: Math.min(...obstacles.map((r) => r.left)),
      top: Math.max(0, Math.min(...obstacles.map((r) => r.top))),
      right: Math.max(...obstacles.map((r) => r.right)),
      bottom: Math.max(...obstacles.map((r) => r.bottom)),
    };
    const floor = reel.getBoundingClientRect().top - origin.top - 8;
    const heroBox = hero.getBoundingClientRect();
    const padRight = parseFloat(getComputedStyle(hero).paddingRight);
    const tw = toggle.current?.offsetWidth ?? 170;
    const th = toggle.current?.offsetHeight ?? 44;
    const right = heroBox.right - origin.left - padRight;
    const top = floor - th;
    obstacles.push({ left: right - tw - 4, top: top - 4, right: right + 4, bottom: floor + 8 });
    // Beside the words when there is room for the card there, else in the band under them.
    const beside = right - words.right - 12;
    const width = Math.min(CARD_WIDTH, beside >= 300 ? beside : right - 8);
    const ceiling = beside >= 300 ? 8 : words.bottom + 8;
    return {
      world: { width: origin.width, floor, obstacles, sink: { x: right - tw / 2, y: top + th / 2 } },
      height: origin.height,
      toggle: { right: origin.width - right, top },
      card: { width, maxHeight: Math.max(0, top - 12 - ceiling) },
      words,
    };
  }, []);

  // Lay the world out, drop the pile once it is in view, and keep up with resizes.
  useEffect(() => {
    if (reduced) return;
    const root = layer.current;
    if (!root) return;
    let started = false;

    const relayout = (): void => {
      const next = measure();
      if (next === null) return;
      world.current = next.world;
      setLayout(next);
      if (bodies.current.length > 0) {
        wake(bodies.current);
        run();
      }
    };

    const start = (): void => {
      const current = world.current;
      const at = measure();
      if (started || current === null || at === null) return;
      started = true;
      startedAt.current = performance.now();
      const sizes = els.current.map((el) => ({ w: el?.offsetWidth ?? 200, h: el?.offsetHeight ?? 44 }));
      const { words } = at;
      // Where cards fall: the columns beside the words reach the floor; over the words, they land on them.
      const regions = [
        { left: 0, right: words.left - 8, depth: current.floor },
        { left: words.right + 8, right: current.width, depth: current.floor },
        { left: words.left, right: words.right, depth: words.top },
      ].filter((region) => region.right - region.left > 160 && region.depth > 40);
      const beside = regions.filter((region) => region.depth === current.floor);
      const useColumns = beside.reduce((sum, region) => sum + region.right - region.left, 0) > current.width * 0.25;
      const band = Math.max(0, current.floor - words.bottom);
      const freeArea = useColumns ? regions.reduce((sum, region) => sum + (region.right - region.left) * region.depth, 0) : current.width * (words.top + band);
      const average = sizes.reduce((sum, size) => sum + size.w * size.h, 0) / Math.max(1, sizes.length);
      const room = Math.min(PILE_ITEMS.length, Math.max(8, Math.floor((freeArea * 0.5) / average)));
      const keep = new Set(PILE_ITEMS.slice(0, room).map((_, index) => index));
      const random = seeded(17);
      bodies.current = PILE_ITEMS.map((_, index) => {
        const size = sizes[index] ?? { w: 200, h: 44 };
        const place = index;
        let x = size.w / 2 + random() * Math.max(1, current.width - size.w);
        let y = -size.h - place * 30 - random() * 50;
        const fits = regions.filter((region) => region.right - region.left >= size.w + 4);
        if (useColumns && fits.length > 0) {
          const total = fits.reduce((sum, region) => sum + (region.right - region.left - size.w) * region.depth, 0);
          let pick = random() * total;
          for (const region of fits) {
            const span = (region.right - region.left - size.w) * region.depth;
            if (pick <= span) {
              x = region.left + size.w / 2 + pick / region.depth;
              break;
            }
            pick -= span;
          }
        } else if (!useColumns && random() * (words.top + band) < band) {
          y = words.bottom + size.h / 2 + 2 + random() * Math.max(0, band - size.h - 4) - place * 4;
        }
        return { x, y, vx: (random() - 0.5) * 120, vy: 200 + random() * 300, w: size.w, h: size.h, scale: 1, mode: keep.has(index) ? 'free' : 'hidden', held: false, still: 0 };
      });
      kept.current = keep;
      setInPlay([...keep]);
      paint();
      run();
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        start();
        run();
      } else if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    });
    const resize = new ResizeObserver(relayout);
    void document.fonts.ready.then(() => {
      relayout();
      observer.observe(root);
      if (root.parentElement) resize.observe(root.parentElement);
    });
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [reduced, measure, run, paint]);

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

  // The digest's lines: only kinds that fell, as many as the room holds, the ones that matter first.
  const rows = useMemo(() => {
    const present = new Set(inPlay.flatMap((index) => {
      const item = PILE_ITEMS[index];
      return item ? [rowOf(item)] : [];
    }));
    const lines = layout === null ? DIGEST_ROWS.length : Math.floor((layout.card.maxHeight - CARD_CHROME) / ROW_HEIGHT);
    const compact = lines < 4;
    // As chips: as many lines of them as the room holds, about three to a line.
    const fit = compact && layout !== null ? Math.max(2, Math.floor((layout.card.maxHeight - 16) / CHIP_LINE) * Math.max(2, Math.floor(layout.card.width / 130))) : lines;
    return { compact, rows: DIGEST_ROWS.filter((row) => present.has(row)).slice(0, fit) };
  }, [inPlay, layout]);

  const digest = useMemo(() => {
    const indices = gathered === '' ? [] : gathered.split(',').map(Number);
    return digestOf(indices.flatMap((index) => {
      const item = PILE_ITEMS[index];
      return item ? [item] : [];
    }));
  }, [gathered]);

  // Geld on: each item is drawn into its line of the card, one after another. Off: they burst back out.
  useEffect(() => {
    const current = world.current;
    const root = layer.current;
    if (current === null || root === null || bodies.current.length === 0) return;
    const random = seeded(geld ? 3 : 5);
    const timers: number[] = [];
    drag.current = null;
    const origin = root.getBoundingClientRect();
    const head = card.current?.getBoundingClientRect();
    let delay = geld ? 220 : 0;
    bodies.current.forEach((body, index) => {
      const item = PILE_ITEMS[index];
      if (!item || !kept.current.has(index)) return;
      if (geld && body.mode === 'free') {
        body.held = false;
        timers.push(window.setTimeout(() => {
          const line = rowEls.current.get(rowOf(item))?.getBoundingClientRect();
          const into = line ?? head;
          body.target = into
            ? { x: into.left - origin.left + Math.min(into.width * 0.5, 150), y: (line ? into.top + into.height / 2 : into.top + 22) - origin.top }
            : current.sink;
          body.mode = 'absorbing';
          run();
        }, delay));
        delay += 70;
      } else if (!geld && body.mode !== 'free') {
        timers.push(window.setTimeout(() => {
          const from = body.target ?? current.sink;
          body.mode = 'free';
          body.scale = 1;
          body.x = from.x;
          body.y = from.y;
          body.vx = (random() - 0.6) * 1300;
          body.vy = -700 - random() * 700;
          body.still = 0;
          run();
        }, delay));
        delay += 30;
      }
    });
    wake(bodies.current);
    run();
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [geld, run]);

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
        {PILE_ITEMS.map((item, index) => (
          <div
            key={item.id}
            ref={(el) => {
              els.current[index] = el;
            }}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ visibility: 'hidden' }}
            className="pointer-events-auto absolute top-0 left-0 origin-center cursor-grab touch-none rounded-lg border bg-card shadow-md select-none will-change-transform active:cursor-grabbing"
          >
            <PileCard item={item} />
          </div>
        ))}
      </div>
      {layout !== null && (
        <div aria-hidden="true" className="absolute" style={{ right: layout.toggle.right, bottom: layout.height - layout.toggle.top + 12 }}>
          <DigestCard digest={digest} rows={rows.rows} compact={rows.compact} maxHeight={layout.card.maxHeight} open={geld} rowRef={rowRef} cardRef={card} width={layout.card.width} />
        </div>
      )}
      <button
        ref={toggle}
        type="button"
        role="switch"
        aria-checked={geld}
        aria-label="Geld"
        onClick={() => {
          interacted.current = true;
          setUsed(true);
          setGeld((value) => !value);
        }}
        style={layout === null ? { visibility: 'hidden' } : { right: layout.toggle.right, top: layout.toggle.top }}
        className={cn(
          'geld-corners geld-cut-[8px] pointer-events-auto absolute inline-flex h-11 items-center gap-3 pr-4 pl-3 text-sm font-semibold shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          geld ? 'border bg-card hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/85',
          !geld && !used && 'animate-[geld-beckon_1.8s_ease-out_infinite]',
        )}
      >
        <span aria-hidden="true" className={cn('relative h-5 w-9 shrink-0 border transition-colors', geld ? 'border-transparent bg-foreground' : 'border-primary-foreground/50 bg-primary-foreground/10')}>
          <span className={cn('absolute top-[3px] left-0 size-3 transition-transform', geld ? 'translate-x-[19px] bg-background' : 'translate-x-[3px] bg-primary-foreground')} />
        </span>
        <span className="min-w-[6.5rem] text-left">{geld ? 'Geld is on' : 'Turn on Geld'}</span>
      </button>
    </div>
  );
}
