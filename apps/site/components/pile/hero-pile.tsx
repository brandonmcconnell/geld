'use client';

import { cn } from 'cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '@/components/use-media-query';
import type { DigestRow } from '@/lib/pile-items';
import { DIGEST_ROWS, digestOf, PILE_ITEMS, rowOf } from '@/lib/pile-items';
import type { Body, Rect, World } from '@/lib/pile-physics';
import { GRAVITY, seeded, settled, step, wake } from '@/lib/pile-physics';

import { DigestCard } from './digest-card';
import { PileCard } from './pile-card';

/** Seconds after the pile lands before Geld switches itself on, unless the reader has already played. */
const AUTO_GELD_AFTER = 2.4;
/** Gaps between lines of the hero's words narrower than this are filled, so no card wedges into one. */
const LINE_GAP = 44;
/** The card's natural width; narrower than this it says less (digest-card's `@max-[23rem]`). */
const CARD_WIDTH = 380;
/** Narrower than this beside the words, the card goes under them as chips instead. */
const CARD_MIN = 240;
/** The least room kept between the heading and the card. */
const CARD_GAP = 40;
const ROW_HEIGHT = 50;
const CARD_CHROME = 48;
const CHIP_LINE = 34;
const GAP_ABOVE_SWITCH = 12;
/** How much of the free space the pile fills; cards overlap at their edges, so it can be most of it. */
const FILL = 0.6;
/** No arc peaks higher than this, so nothing is flung up under the header. */
const HIGHEST = 70;

interface Layout {
  readonly world: World;
  readonly height: number;
  /** Anchored by its right edge, so the label changing never moves it. */
  readonly toggle: { readonly right: number; readonly top: number };
  readonly card: { readonly left: number; readonly width: number; readonly maxHeight: number };
  readonly words: Rect;
}

/** Where cards fall from: a span of x they fall through, and whether they are poured in from above or appear in place. */
interface Region {
  readonly left: number;
  readonly right: number;
  /** How far down a card falls there before it lands, which is how much room it has. */
  readonly depth: number;
  /** Cards appear at this y instead of falling from the top (a band under the words, which they would land on). */
  readonly at?: number;
}

/** Only the column right of the words, so nothing falls on the heading or beside and under it; with no room there (a phone), the band under the words. */
function regionsOf({ words, world }: Layout): Region[] {
  const right: Region = { left: words.right + 8, right: world.width, depth: world.floor };
  const band = world.floor - words.bottom;
  if (right.right - right.left > 220) return [right];
  return band >= 60 ? [{ left: 0, right: world.width, depth: band, at: words.bottom + 30 }] : [];
}

interface Shot {
  readonly vx: number;
  readonly vy: number;
  readonly flight: number;
}

/** The launch that lands a body from `from` at `to` over an arc peaking at `peak`, or null when that arc would hit an obstacle on the way. */
function arc(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }, peak: number, body: Body, obstacles: readonly Rect[]): Shot | null {
  const up = Math.max(1, from.y - peak);
  const down = Math.max(1, to.y - peak);
  const flight = Math.sqrt((2 * up) / GRAVITY) + Math.sqrt((2 * down) / GRAVITY);
  const vx = (to.x - from.x) / flight;
  const vy = -Math.sqrt(2 * GRAVITY * up);
  const hw = body.w / 2;
  const hh = body.h / 2;
  // The last stretch is landing, where touching what it lands on is the point.
  for (let t = 0; t < flight * 0.85; t += 1 / 60) {
    const x = from.x + vx * t;
    const y = from.y + vy * t + 0.5 * GRAVITY * t * t;
    if (obstacles.some((r) => x + hw > r.left && x - hw < r.right && y + hh > r.top && y - hh < r.bottom)) return null;
  }
  return { vx, vy, flight };
}

/**
 * The hero's pile: everything a pull request asks of its reviewer at once
 * (files, comments, bot notes, an agent's score, checks, previews, reports,
 * verdicts) tumbles into the space around the hero's words. Turning Geld on
 * gathers each into its line of a digest card beside the switch; off, the
 * card explodes and the mess lands all over again. Every card can be dragged
 * and thrown. Lives on a layer over the hero that takes no room, with the
 * hero's words as obstacles; with reduced motion there is no pile at all.
 */
export function HeroPile() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const layer = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const rowEls = useRef(new Map<DigestRow, HTMLElement>());
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  /** The items in play: about as many as the free space holds, in the order they fall. */
  const kept = useRef<ReadonlySet<number>>(new Set());
  /** Items still waiting to fall. */
  const pending = useRef(new Set<number>());
  const pours = useRef<number[]>([]);
  /** Where an exploding card may land. */
  const landing = useRef<{ readonly regions: readonly Region[] } | null>(null);
  /** The invisible walls the pile falls and explodes within; a card someone drags leaves them. */
  const fence = useRef<{ readonly left: number; readonly right: number } | undefined>(undefined);
  const world = useRef<World | null>(null);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const interacted = useRef(false);
  const landedAt = useRef<number | null>(null);
  /** When the last card was poured; a pile still jostling this long after counts as landed. */
  const pouredAt = useRef<number | null>(null);
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
      const lastPour = pouredAt.current;
      if (landedAt.current === null && pending.current.size === 0 && bodies.current.length > 0 && (settled(bodies.current) || (lastPour !== null && now - lastPour > 3000))) landedAt.current = now;
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
    // Beside the words where there is room: centred over the switch, pushed right as the heading comes near until it is flush with the switch, then narrower. Else under the words.
    const toggleRight = origin.width - right;
    const reach = right + Math.max(0, Math.min(120, toggleRight - 24));
    const nearest = words.right + CARD_GAP;
    const fitsBeside = reach - nearest >= CARD_MIN;
    const width = fitsBeside ? Math.min(CARD_WIDTH, reach - nearest) : Math.min(CARD_WIDTH, right - 8);
    const left = fitsBeside ? Math.max(nearest, Math.min(reach - width, right - tw / 2 - width / 2)) : right - width;
    const ceiling = fitsBeside ? 8 : words.bottom + 8;
    return {
      world: { width: origin.width, floor, obstacles, sink: { x: right - tw / 2, y: top + th / 2 } },
      height: origin.height,
      toggle: { right: toggleRight, top },
      card: { left, width, maxHeight: Math.max(0, top - GAP_ABOVE_SWITCH - ceiling) },
      words,
    };
  }, []);

  // Lay the world out, pour the pile once it is in view, and keep up with resizes.
  useEffect(() => {
    if (reduced) return;
    const root = layer.current;
    if (!root) return;
    let started = false;
    let disposed = false;
    let at: Layout | null = null;

    // Where cards land and the walls they keep to follow the page as it resizes; a card someone dragged keeps none.
    const fenceIn = (next: Layout): Region[] => {
      const regions = regionsOf(next);
      landing.current = { regions };
      fence.current = regions[0] ? { left: regions[0].left, right: regions[0].right } : undefined;
      for (const body of bodies.current) if (body.fence !== undefined) body.fence = fence.current;
      return regions;
    };

    const relayout = (): void => {
      const next = measure();
      if (next === null) return;
      at = next;
      world.current = next.world;
      setLayout(next);
      if (started) fenceIn(next);
      if (bodies.current.length > 0) {
        wake(bodies.current);
        run();
      }
    };

    const start = (): void => {
      const current = at;
      if (started || current === null) return;
      started = true;
      const sizes = els.current.map((el) => ({ w: el?.offsetWidth ?? 200, h: el?.offsetHeight ?? 44 }));
      const average = sizes.reduce((sum, size) => sum + size.w * size.h, 0) / Math.max(1, sizes.length);
      const regions = fenceIn(current);
      const area = regions.reduce((sum, region) => sum + (region.right - region.left) * region.depth, 0);
      const room = Math.min(PILE_ITEMS.length, Math.max(8, Math.floor((area * FILL) / average)));
      const keep = new Set(PILE_ITEMS.slice(0, room).map((_, index) => index));
      const random = seeded(17);
      bodies.current = PILE_ITEMS.map((_, index) => {
        const size = sizes[index] ?? { w: 200, h: 44 };
        // Which card ends up over which is shuffled, not the order they fell in.
        const el = els.current[index];
        if (el) el.style.zIndex = String(Math.floor(random() * 30));
        return { x: 0, y: -size.h, vx: 0, vy: 0, w: size.w, h: size.h, scale: 1, mode: 'hidden', held: false, still: 0 };
      });
      kept.current = keep;
      pending.current = new Set(keep);
      setInPlay([...keep]);
      // Poured one at a time at uneven intervals into spots across the free space, each tumbling and thrown a little sideways.
      let delay = 0;
      for (const index of keep) {
        const size = sizes[index] ?? { w: 200, h: 44 };
        delay += 40 + random() * 160;
        const fits = regions.filter((region) => region.right - region.left >= size.w * 0.6);
        const total = fits.reduce((sum, region) => sum + (region.right - region.left) * region.depth, 0);
        let pick = random() * total;
        const region = fits.find((r) => (pick -= (r.right - r.left) * r.depth) <= 0) ?? fits[0];
        const across = random();
        const tilt = (random() - 0.5) * 0.9;
        const spin = (random() < 0.5 ? -1 : 1) * (4 + random() * 8);
        const drift = (random() - 0.5) * 700;
        const speed = 200 + random() * 500;
        pours.current.push(
          window.setTimeout(() => {
            const body = bodies.current[index];
            if (!body || !pending.current.has(index) || region === undefined) return;
            pending.current.delete(index);
            pouredAt.current = performance.now();
            const span = region.right - region.left - body.w;
            body.x = region.left + body.w / 2 + (span > 0 ? across * span : span / 2);
            body.y = region.at ?? -body.h;
            body.scale = region.at === undefined ? 1 : 0.6;
            body.vx = drift;
            body.vy = region.at === undefined ? speed : speed * 0.3;
            body.angle = tilt;
            body.spin = spin;
            body.fence = fence.current;
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
      if (disposed) return;
      relayout();
      observer.observe(root);
      if (root.parentElement) resize.observe(root.parentElement);
    });
    const timers = pours.current;
    return () => {
      disposed = true;
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
    return { compact, rows: DIGEST_ROWS.filter((row) => present.has(row)).slice(0, fit) };
  }, [inPlay, layout]);

  const digest = useMemo(() => {
    const indices = gathered === '' ? [] : gathered.split(',').map(Number);
    return digestOf(
      indices.flatMap((index) => {
        const item = PILE_ITEMS[index];
        return item ? [item] : [];
      }),
    );
  }, [gathered]);

  // Geld on: each item is drawn into its line of the card, one after another. Off: the card explodes.
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
    const centre = head ? { x: head.left - origin.left + head.width / 2, y: head.top - origin.top + head.height / 2 } : current.sink;
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
        // Every item flies out of its line at once, each aimed at a random spot across the free space and launched on the arc that lands it there under ordinary gravity, so the mess lands all over rather than heaped on one side.
        // Caught on its way in, it flies out from where it is; one already swallowed comes out of its line.
        const from = body.mode === 'absorbing' ? { x: body.x, y: body.y } : (body.target ?? centre);
        const choices = landing.current?.regions.filter((region) => region.right - region.left >= body.w * 0.6) ?? [];
        const total = choices.reduce((sum, region) => sum + (region.right - region.left) * region.depth, 0);
        // A few spots tried in turn, each with arcs from low to high, until one clears the hero's words all the way.
        let shot: Shot | null = null;
        for (let attempt = 0; attempt < 6 && shot === null && total > 0; attempt++) {
          let pick = random() * total;
          const region = choices.find((r) => (pick -= (r.right - r.left) * r.depth) <= 0) ?? choices[0];
          if (region === undefined) break;
          const span = Math.max(0, region.right - region.left - body.w);
          const to = { x: region.left + body.w / 2 + random() * span, y: (region.at === undefined ? region.depth : current.floor) - body.h / 2 };
          const low = Math.min(from.y, to.y) - 40 - random() * 160;
          for (let peak = low; peak >= HIGHEST - 1 && shot === null; peak -= 60) shot = arc(from, to, Math.max(HIGHEST, peak), body, current.obstacles);
        }
        if (shot === null) {
          const away = Math.atan2(from.y - centre.y, from.x - centre.x) + (random() - 0.5) * 2.4;
          shot = { vx: Math.cos(away) * (500 + random() * 1400), vy: -150 - random() * 650, flight: 0.5 };
        }
        const { vx, vy, flight } = shot;
        const inFlight = body.mode === 'absorbing';
        const launch = () => {
          body.mode = 'free';
          // One on its way in grows back as it flies, rather than snapping to size and to a new tilt where it is.
          if (!inFlight) {
            body.scale = 1;
            body.angle = (random() - 0.5) * 0.8;
          }
          body.x = from.x;
          body.y = from.y;
          body.vx = vx;
          body.vy = vy;
          body.spin = (random() < 0.5 ? -1 : 1) * (6 + random() * 14);
          // Through the others still in flight, so the arcs are not knocked off course; onto those already down, and solid once it lands.
          body.ghost = flight * 1.5;
          body.settle = 0;
          body.settleFor = 0;
          body.fence = fence.current;
          body.still = 0;
          run();
        };
        if (inFlight) launch();
        else timers.push(window.setTimeout(launch, random() * 50));
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
    body.fence = undefined;
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
        <div aria-hidden="true" className="absolute z-40" style={{ left: layout.card.left, bottom: layout.height - layout.toggle.top + GAP_ABOVE_SWITCH }}>
          <DigestCard
            digest={digest}
            rows={rows.rows}
            compact={rows.compact}
            maxHeight={layout.card.maxHeight}
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
          'geld-corners geld-cut-[8px] pointer-events-auto absolute z-40 inline-flex h-11 items-center gap-3 pr-4 pl-3 text-sm font-semibold shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
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
