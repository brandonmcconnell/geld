'use client';

import { cn } from 'cn';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '@/components/use-media-query';
import type { DigestRow } from '@/lib/pile-items';
import { DIGEST_ROWS, digestOf, PILE_ITEMS, rowOf } from '@/lib/pile-items';
import type { Body, Rect, World } from '@/lib/pile-physics';
import { seeded, settled, step, wake } from '@/lib/pile-physics';

import { DigestCard } from './digest-card';
import { PileCard } from './pile-card';

/** Seconds after the pile lands before Geld switches itself on, unless the reader has already played. */
const AUTO_GELD_AFTER = 2.4;
/** Gaps between lines of the hero's words narrower than this are filled, so no card wedges into one. */
const LINE_GAP = 44;
const CARD_WIDTH = 400;
const ROW_HEIGHT = 50;
const CARD_CHROME = 48;
const CHIP_LINE = 34;
/** How deep the cup is where there is room; the card's lines stretch to fill it. */
const CUP_DEPTH = 440;
/** Thick on the outside, so a card falling fast cannot pass through a wall in one step. */
const WALL = 18;
const GAP_ABOVE_SWITCH = 12;

interface Layout {
  readonly world: World;
  readonly width: number;
  readonly height: number;
  /** Anchored by its right edge, so the label changing never moves it. */
  readonly toggle: { readonly right: number; readonly top: number };
  readonly card: { readonly width: number; readonly maxHeight: number };
}

/**
 * The hero's pile: everything a pull request asks of its reviewer at once
 * (files, comments, bot notes, an agent's score, checks, previews, reports,
 * verdicts) is poured, tumbling, into an open cup that stands on Geld's
 * switch. The cup is the digest card's outline: turning Geld on fills it in,
 * each card drawn into its line of the digest as it lands; off, they burst
 * back out into the cup. Every card can be dragged and thrown. Lives on a
 * layer over the hero that takes no room, with the hero's words as
 * obstacles; with reduced motion there is no pile at all.
 */
export function HeroPile() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const layer = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<DigestRow, HTMLElement>());
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  /** The items in play: about as many as the cup holds, in the order they fall. */
  const kept = useRef<ReadonlySet<number>>(new Set());
  /** Items still waiting to be poured. */
  const pending = useRef(new Set<number>());
  const pours = useRef<number[]>([]);
  const base = useRef<World | null>(null);
  const world = useRef<World | null>(null);
  const cupRef = useRef<Rect | null>(null);
  /** Exploded once Geld is first turned off: from then on the mess lands anywhere. */
  const broken = useRef(false);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const interacted = useRef(false);
  const landedAt = useRef<number | null>(null);
  const drag = useRef<{ index: number; dx: number; dy: number; x: number; y: number; t: number; vx: number; vy: number } | null>(null);

  const [geld, setGeld] = useState(false);
  const [used, setUsed] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [cup, setCup] = useState<Rect | null>(null);
  const [cupGone, setCupGone] = useState(false);
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
        if (kept.current.has(index) && !pending.current.has(index)) hidden.push(index);
        return;
      }
      el.style.visibility = 'visible';
      el.style.opacity = body.mode === 'absorbing' ? String(Math.min(1, (body.scale - 0.25) / 0.5)) : '1';
      el.style.transform = `translate3d(${body.x - body.w / 2}px, ${body.y - body.h / 2}px, 0) rotate(${body.angle ?? 0}rad) scale(${body.scale})`;
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
      if (landedAt.current === null && pending.current.size === 0 && bodies.current.length > 0 && settled(bodies.current)) landedAt.current = now;
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
    const wordsRight = Math.max(...obstacles.map((r) => r.right));
    const wordsBottom = Math.max(...obstacles.map((r) => r.bottom));
    const floor = reel.getBoundingClientRect().top - origin.top - 8;
    const heroBox = hero.getBoundingClientRect();
    const padRight = parseFloat(getComputedStyle(hero).paddingRight);
    const tw = toggle.current?.offsetWidth ?? 170;
    const th = toggle.current?.offsetHeight ?? 44;
    const right = heroBox.right - origin.left - padRight;
    const top = floor - th;
    obstacles.push({ left: right - tw - 4, top: top - 4, right: right + 4, bottom: floor + 8 });
    // Beside the words when there is room for the card there, else in the band under them.
    const beside = right - wordsRight - 12;
    const width = Math.min(CARD_WIDTH, beside >= 300 ? beside : right - 8);
    const ceiling = beside >= 300 ? 8 : wordsBottom + 8;
    return {
      world: { width: origin.width, floor, obstacles, sink: { x: right - tw / 2, y: top + th / 2 } },
      width: origin.width,
      height: origin.height,
      toggle: { right: origin.width - right, top },
      card: { width, maxHeight: Math.max(0, top - GAP_ABOVE_SWITCH - ceiling) },
    };
  }, []);

  // The digest's lines: only kinds in the pile, as many as the room holds, the ones that matter first.
  const rows = useMemo(() => {
    const present = new Set(
      inPlay.flatMap((index) => {
        const item = PILE_ITEMS[index];
        return item ? [rowOf(item)] : [];
      }),
    );
    const lines = layout === null ? DIGEST_ROWS.length : Math.floor((layout.card.maxHeight - CARD_CHROME) / ROW_HEIGHT);
    const compact = lines < 4;
    // As chips: as many lines of them as the room holds, about three to a line.
    const fit = compact && layout !== null ? Math.max(2, Math.floor((layout.card.maxHeight - 16) / CHIP_LINE) * Math.max(2, Math.floor(layout.card.width / 130))) : lines;
    // Before anything is poured, every kind that could fall: the cup is sized from the card.
    const shown = present.size > 0 ? DIGEST_ROWS.filter((row) => present.has(row)) : DIGEST_ROWS;
    return { compact, rows: shown.slice(0, fit) };
  }, [inPlay, layout]);

  // The cup is the card's own box, standing on the switch: `CUP_DEPTH` deep where there is room, never shallower than the card's lines.
  useLayoutEffect(() => {
    const el = card.current;
    const at = layout;
    if (el === null || at === null) return;
    const natural = [...el.children].reduce((sum, child) => sum + (child instanceof HTMLElement ? child.offsetHeight : 0), 2);
    const depth = Math.min(at.card.maxHeight, Math.max(natural, CUP_DEPTH));
    const right = at.width - at.toggle.right;
    const bottom = at.toggle.top - GAP_ABOVE_SWITCH;
    const next: Rect = { left: right - at.card.width, top: bottom - depth, right, bottom };
    const previous = cupRef.current;
    if (previous && previous.left === next.left && previous.top === next.top && previous.right === next.right && previous.bottom === next.bottom) return;
    cupRef.current = next;
    setCup(next);
    const current = base.current;
    if (current === null || broken.current) return;
    const walls: Rect[] = [
      { left: next.left - WALL, top: next.top, right: next.left + 1, bottom: next.bottom + WALL },
      { left: next.right - 1, top: next.top, right: next.right + WALL, bottom: next.bottom + WALL },
      { left: next.left - WALL, top: next.bottom - 1, right: next.right + WALL, bottom: next.bottom + WALL },
    ];
    world.current = { ...current, obstacles: [...current.obstacles, ...walls] };
    if (bodies.current.length > 0) {
      wake(bodies.current);
      run();
    }
  }, [layout, rows, run]);

  // Lay the world out, pour the pile once it is in view, and keep up with resizes.
  useEffect(() => {
    if (reduced) return;
    const root = layer.current;
    if (!root) return;
    let started = false;

    const relayout = (): void => {
      const next = measure();
      if (next === null) return;
      base.current = next.world;
      if (world.current === null || broken.current) world.current = next.world;
      setLayout(next);
    };

    const start = (): void => {
      const into = cupRef.current;
      if (started) return;
      if (into === null || world.current === null) {
        requestAnimationFrame(start);
        return;
      }
      started = true;
      const sizes = els.current.map((el) => ({ w: el?.offsetWidth ?? 200, h: el?.offsetHeight ?? 44 }));
      const average = sizes.reduce((sum, size) => sum + size.w * size.h, 0) / Math.max(1, sizes.length);
      const width = into.right - into.left;
      // About what the cup holds: tumbled cards leave gaps, so a pile fills a bit over half of it.
      const room = Math.min(PILE_ITEMS.length, Math.max(5, Math.floor((width * (into.bottom - into.top) * 0.6) / average)));
      const keep = new Set(PILE_ITEMS.slice(0, room).map((_, index) => index));
      // Where the words stand over the cup (a phone), cards appear at its mouth instead of landing on the words.
      const covered = (base.current?.obstacles ?? []).some((r) => r.bottom <= into.top + 1 && r.right > into.left && r.left < into.right);
      const random = seeded(17);
      bodies.current = PILE_ITEMS.map((_, index) => {
        const size = sizes[index] ?? { w: 200, h: 44 };
        return { x: 0, y: -size.h, vx: 0, vy: 0, w: size.w, h: size.h, scale: 1, mode: 'hidden', held: false, still: 0 };
      });
      kept.current = keep;
      pending.current = new Set(keep);
      setInPlay([...keep]);
      // Poured one at a time at uneven intervals, each into a random spot across the cup, tumbling.
      let delay = 0;
      for (const index of keep) {
        delay += 70 + random() * 230;
        const x = random();
        const tilt = (random() - 0.5) * 0.5;
        const spin = (random() - 0.5) * 9;
        // Toward the cup's far side, so paths cross and the heap jumbles without flying over the rim.
        const drift = (0.5 - x) * 520 + (random() - 0.5) * 160;
        const speed = 250 + random() * 350;
        pours.current.push(
          window.setTimeout(() => {
            const body = bodies.current[index];
            const cupNow = cupRef.current;
            if (!body || cupNow === null || !pending.current.has(index)) return;
            pending.current.delete(index);
            const span = cupNow.right - cupNow.left - body.w;
            body.x = cupNow.left + body.w / 2 + (span > 0 ? x * span : span / 2);
            body.y = covered ? cupNow.top + body.h / 2 : -body.h;
            body.scale = covered ? 0.6 : 1;
            body.vx = drift;
            body.vy = covered ? speed * 0.3 : speed;
            body.angle = tilt;
            body.spin = spin;
            body.still = 0;
            body.mode = 'free';
            run();
          }, delay),
        );
      }
      paint();
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
    const timers = pours.current;
    return () => {
      observer.disconnect();
      resize.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
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

  const digest = useMemo(() => {
    const indices = gathered === '' ? [] : gathered.split(',').map(Number);
    return digestOf(
      indices.flatMap((index) => {
        const item = PILE_ITEMS[index];
        return item ? [item] : [];
      }),
    );
  }, [gathered]);

  // Geld on: each item is drawn into its line of the card, one after another. Off: they burst back out into the cup.
  useEffect(() => {
    const current = world.current;
    const root = layer.current;
    if (current === null || root === null || bodies.current.length === 0) return;
    const random = seeded(geld ? 3 : 5);
    const timers: number[] = [];
    drag.current = null;
    // Anything not yet poured goes straight into the card.
    if (geld) {
      pours.current.forEach((timer) => window.clearTimeout(timer));
      pending.current.clear();
    }
    const origin = root.getBoundingClientRect();
    const head = card.current?.getBoundingClientRect();
    const exploding = !geld && bodies.current.some((body) => body.mode !== 'free' && kept.current.has(bodies.current.indexOf(body)));
    if (exploding && !broken.current && base.current !== null) {
      broken.current = true;
      world.current = base.current;
      setCupGone(true);
    }
    let delay = geld ? 220 : 0;
    bodies.current.forEach((body, index) => {
      const item = PILE_ITEMS[index];
      if (!item || !kept.current.has(index)) return;
      if (geld && body.mode === 'free') {
        body.held = false;
        timers.push(
          window.setTimeout(() => {
            const line = rowEls.current.get(rowOf(item))?.getBoundingClientRect();
            const into = line ?? head;
            body.target = into ? { x: into.left - origin.left + Math.min(into.width * 0.5, 150), y: (line ? into.top + into.height / 2 : into.top + 22) - origin.top } : current.sink;
            body.mode = 'absorbing';
            body.spin = 0;
            run();
          }, delay),
        );
        delay += 70;
      } else if (!geld && body.mode !== 'free') {
        // Off: the card explodes. Every item flies out of its line at once, away from the card's middle and mostly sideways, so the mess lands all over rather than back in a column.
        const into = cupRef.current;
        const centre = into ? { x: (into.left + into.right) / 2, y: (into.top + into.bottom) / 2 } : current.sink;
        const from = body.target ?? centre;
        const away = Math.atan2(from.y - centre.y, from.x - centre.x) + (random() - 0.5) * 1.6;
        const speed = 800 + random() * 1000;
        timers.push(
          window.setTimeout(() => {
            body.mode = 'free';
            body.scale = 1;
            body.x = from.x + (random() - 0.5) * 80;
            body.y = from.y + (random() - 0.5) * 20;
            body.ghost = 0.45;
            body.vx = Math.cos(away) * speed;
            body.vy = Math.min(-120, Math.sin(away) * speed * 0.35 - 250);
            body.angle = (random() - 0.5) * 0.5;
            body.spin = (random() - 0.5) * 16;
            body.still = 0;
            run();
          }, random() * 50),
        );
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
      body.spin = Math.max(-8, Math.min(8, body.vx * 0.004));
      body.still = 0;
    }
    drag.current = null;
    run();
  };

  if (reduced) return null;

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-10 [overflow-x:clip]">
      {cup !== null && (
        <div
          aria-hidden="true"
          className={cn('absolute rounded-b-xl border-2 border-t-0 border-foreground/35 transition-opacity duration-300', (geld || cupGone) && 'opacity-0')}
          style={{ left: cup.left, top: cup.top, width: cup.right - cup.left, height: cup.bottom - cup.top }}
        />
      )}
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
        <div aria-hidden="true" className="absolute" style={{ right: layout.toggle.right, bottom: layout.height - layout.toggle.top + GAP_ABOVE_SWITCH }}>
          <DigestCard
            digest={digest}
            rows={rows.rows}
            compact={rows.compact}
            maxHeight={layout.card.maxHeight}
            minHeight={cup === null ? 0 : cup.bottom - cup.top}
            open={geld}
            rowRef={rowRef}
            cardRef={card}
            width={layout.card.width}
          />
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
