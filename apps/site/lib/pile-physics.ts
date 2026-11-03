/**
 * A small physics world for the home page's file pile: axis-aligned boxes that
 * fall, stack, slide and get thrown, around fixed obstacles (the hero's words),
 * and that can be drawn into a sink and swallowed. Pure, so it is tested
 * without a DOM. Boxes never rotate; the pile reads as physical without it.
 */

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type BodyMode = 'free' | 'absorbing' | 'hidden';

export interface Body {
  /** Centre. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Full size at scale 1. */
  readonly w: number;
  readonly h: number;
  scale: number;
  mode: BodyMode;
  /** Moved by the pointer: positioned from outside and never pushed by anything. */
  held: boolean;
  /** Substeps in a row it has barely moved; past `SLEEP_AFTER` it rests until something moves it. */
  still: number;
}

export interface World {
  readonly width: number;
  /** Bodies rest on this line; nothing above it is a ceiling. */
  readonly floor: number;
  readonly obstacles: readonly Rect[];
  /** Where absorbing bodies are drawn to. */
  readonly sink: { readonly x: number; readonly y: number };
}

const GRAVITY = 2400;
const FRICTION = 0.8;
const ITERATIONS = 6;
const MAX_SPEED = 3200;
const SLEEP_SPEED = 12;
const SLEEP_AFTER = 24;
const ABSORBED_SCALE = 0.25;
const SWALLOW_DISTANCE = 10;

export function rectOf(body: Body): Rect {
  const hw = (body.w * body.scale) / 2;
  const hh = (body.h * body.scale) / 2;
  return { left: body.x - hw, top: body.y - hh, right: body.x + hw, bottom: body.y + hh };
}

/** Advance the world by `dt` seconds (split into steps of at most 1/120 s). */
export function step(bodies: readonly Body[], world: World, dt: number): void {
  const steps = Math.max(1, Math.ceil(dt * 120));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) substep(bodies, world, h);
}

/**
 * Position-based: free bodies move by their velocity, overlaps are resolved by
 * moving positions only, and the velocity is then what the move actually was.
 * Energy leaves through every contact, so stacks come to rest instead of
 * trading impulses forever.
 */
function substep(bodies: readonly Body[], world: World, dt: number): void {
  const free: Body[] = [];
  const before = new Map<Body, { readonly x: number; readonly y: number }>();
  const grounded = new Set<Body>();
  for (const body of bodies) {
    if (body.mode === 'hidden') continue;
    if (body.mode === 'absorbing') {
      // A damped spring toward the sink, shrinking on the way, swallowed on arrival.
      const dx = world.sink.x - body.x;
      const dy = world.sink.y - body.y;
      body.vx = (body.vx + dx * 90 * dt) * Math.exp(-9 * dt);
      body.vy = (body.vy + dy * 90 * dt) * Math.exp(-9 * dt);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.scale += (ABSORBED_SCALE - body.scale) * Math.min(1, 7 * dt);
      if (Math.hypot(dx, dy) < SWALLOW_DISTANCE) body.mode = 'hidden';
      continue;
    }
    free.push(body);
    before.set(body, { x: body.x, y: body.y });
    body.scale += (1 - body.scale) * Math.min(1, 10 * dt);
    if (body.held || body.still >= SLEEP_AFTER) continue;
    body.vy += GRAVITY * dt;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > MAX_SPEED) {
      body.vx *= MAX_SPEED / speed;
      body.vy *= MAX_SPEED / speed;
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }

  for (let i = 0; i < ITERATIONS; i++) {
    for (let a = 0; a < free.length; a++) {
      const first = free[a];
      if (first === undefined) continue;
      for (let b = a + 1; b < free.length; b++) {
        const second = free[b];
        if (second !== undefined) separate(first, second, grounded);
      }
    }
    for (const body of free) {
      if (body.held) continue;
      for (const obstacle of world.obstacles) pushOut(body, obstacle, grounded);
      bound(body, world, grounded);
    }
  }

  for (const body of free) {
    if (body.held) continue;
    const start = before.get(body);
    if (start === undefined) continue;
    body.vx = (body.x - start.x) / dt;
    body.vy = (body.y - start.y) / dt;
    if (grounded.has(body)) body.vx *= FRICTION;
    if (Math.hypot(body.vx, body.vy) < SLEEP_SPEED) {
      body.still += 1;
      if (body.still >= SLEEP_AFTER) {
        body.vx = 0;
        body.vy = 0;
      }
    } else {
      body.still = 0;
    }
  }
}

/** Keep a body inside the side walls and above the floor. */
function bound(body: Body, world: World, grounded: Set<Body>): void {
  const r = rectOf(body);
  if (r.left < 0) body.x -= r.left;
  else if (r.right > world.width) body.x -= r.right - world.width;
  if (r.bottom > world.floor) {
    body.y -= r.bottom - world.floor;
    grounded.add(body);
  }
}

/** Push a body out of a fixed rectangle along the shallower axis. */
function pushOut(body: Body, obstacle: Rect, grounded: Set<Body>): void {
  const r = rectOf(body);
  const ox = Math.min(r.right, obstacle.right) - Math.max(r.left, obstacle.left);
  const oy = Math.min(r.bottom, obstacle.bottom) - Math.max(r.top, obstacle.top);
  if (ox <= 0 || oy <= 0) return;
  if (ox < oy) {
    body.x += body.x < (obstacle.left + obstacle.right) / 2 ? -ox : ox;
  } else if (body.y < (obstacle.top + obstacle.bottom) / 2) {
    body.y -= oy;
    grounded.add(body);
  } else {
    body.y += oy;
  }
}

/** Separate two overlapping bodies; a held body does not move, so the other takes all of it. */
function separate(a: Body, b: Body, grounded: Set<Body>): void {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  if (ox <= 0 || oy <= 0) return;
  if (a.held && b.held) return;
  // A resting body pushed by a moving one takes the whole push, so a pile stays put under a single landing.
  const aRests = a.held || a.still >= SLEEP_AFTER;
  const bRests = b.held || b.still >= SLEEP_AFTER;
  const share = a.held ? 0 : b.held ? 1 : aRests && !bRests ? 0 : bRests && !aRests ? 1 : 0.5;
  if (ox < oy) {
    const sign = a.x < b.x ? -1 : 1;
    a.x += sign * ox * share;
    b.x -= sign * ox * (1 - share);
  } else {
    const sign = a.y < b.y ? -1 : 1;
    a.y += sign * oy * share;
    b.y -= sign * oy * (1 - share);
    grounded.add(sign < 0 ? a : b);
  }
  // A resting body that actually got moved (by the pointer, or by another resting body) wakes.
  const push = Math.min(ox, oy);
  if (aRests && !a.held && push * share > 0.5) a.still = 0;
  if (bRests && !b.held && push * (1 - share) > 0.5) b.still = 0;
}

/** Whether nothing is moving enough to be worth another frame. */
export function settled(bodies: readonly Body[]): boolean {
  return bodies.every((body) => body.mode === 'hidden' || (body.mode === 'free' && !body.held && body.still >= SLEEP_AFTER && Math.abs(1 - body.scale) < 0.01));
}

/** Wake every body, for when the world itself changes (a resize, Geld switched). */
export function wake(bodies: readonly Body[]): void {
  for (const body of bodies) body.still = 0;
}

/** A deterministic random sequence, so the pile lands the same way for everyone. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
