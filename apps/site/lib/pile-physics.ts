/**
 * A small physics world for the home page's file pile: axis-aligned boxes that
 * fall, stack, slide and get thrown, around fixed obstacles (the hero's words),
 * and that can be drawn into a sink and swallowed. Pure, so it is tested
 * without a DOM. Boxes tilt and spin as they tumble, and against each other
 * they collide a little smaller than they are drawn, growing only partway with
 * the tilt, so a pile overlaps at its edges like a heap of papers rather than
 * stacking like bricks. Against obstacles, the walls and the floor they are the
 * full box they are drawn in, tilt and all, so no corner covers the words.
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
  /** Where it is drawn to while absorbing; the world's sink when unset. */
  target?: { readonly x: number; readonly y: number };
  /** Tilt in radians, and how fast it is turning; a box that lands stops turning. */
  angle?: number;
  spin?: number;
  /** Seconds it may still pass through other bodies in flight: a burst of cards from one spot flies apart instead of being shoved upward. It lands on what has already landed, and ends on landing. */
  ghost?: number;
  /** Seconds after passing through others in which overlaps come apart gently, so a heap that landed tangled eases apart instead of erupting. */
  settle?: number;
  /** How much longer a tangle can keep it settling, so a heap that never quite comes apart still comes to rest. */
  settleFor?: number;
  /** Seconds in which it comes out of the words and walls gently: let go over them, it slid out rather than jumping clear in a step. */
  escape?: number;
  /** Side walls of its own, inside the world's: where it falls is kept to a part of the page until someone moves it. */
  fence?: { readonly left: number; readonly right: number } | undefined;
}

export interface World {
  readonly width: number;
  /** Bodies rest on this line; nothing above it is a ceiling. */
  readonly floor: number;
  readonly obstacles: readonly Rect[];
  /** Where absorbing bodies are drawn to. */
  readonly sink: { readonly x: number; readonly y: number };
}

export const GRAVITY = 2400;
const FRICTION = 0.8;
const ITERATIONS = 6;
const MAX_SPEED = 3200;
/** The most speed a body takes from being pushed out of an overlap, so untangling a heap never launches it. */
const CORRECTION_SPEED = 250;
/** Two bodies meeting slower than this are resting against each other rather than colliding. */
const CONTACT_SPEED = 150;
/** How close a resting body's bottom must be to what is under it to count as held up. */
const TOUCH = 2;
const SETTLE_SPEED = 90;
const SETTLE_AFTER_GHOST = 1;
const SETTLE_AT_MOST = 2;
/** The share of an overlap resolved per iteration while settling. */
const SETTLE_SHARE = 0.15;
/** A card in flight lands on one only when it meets it this close to its top; deeper in, it falls on through, rather than landing inside it and being pried out. */
const LAND_DEPTH = 14;
const SLEEP_SPEED = 50;
const SLEEP_AFTER = 24;
/** How far per substep a body overhanging the edge of what it rests on slides off it. */
const SPILL = 0.7;
/** How far per iteration a body let go inside the words or past the walls is pushed out of them, about 430px/s. */
const ESCAPE_STEP = 0.6;
const ESCAPE_BOUNCE = 60;
const ABSORBED_SCALE = 0.25;
const SWALLOW_DISTANCE = 10;
const MAX_TILT = 0.45;
/** How much of its size a body takes up against other bodies. */
const NESTLE_X = 0.82;
const NESTLE_Y = 0.78;
/** How much of a tilted box's true bounding height it collides with. */
const TILT_HEIGHT = 0.45;

/** The box a body is drawn in, tilt and all: what keeps it off the words, inside the walls and above the floor. */
export function boundsOf(body: Body): Rect {
  const sin = Math.abs(Math.sin(body.angle ?? 0));
  const cos = Math.abs(Math.cos(body.angle ?? 0));
  const hw = ((body.w * cos + body.h * sin) * body.scale) / 2;
  const hh = ((body.h * cos + body.w * sin) * body.scale) / 2;
  return { left: body.x - hw, top: body.y - hh, right: body.x + hw, bottom: body.y + hh };
}

export function rectOf(body: Body): Rect {
  const sin = Math.abs(Math.sin(body.angle ?? 0));
  const cos = Math.abs(Math.cos(body.angle ?? 0));
  const hw = ((body.w * cos + body.h * sin) * body.scale) / 2;
  const hh = ((body.h * cos + body.w * sin * TILT_HEIGHT) * body.scale) / 2;
  return { left: body.x - hw, top: body.y - hh, right: body.x + hw, bottom: body.y + hh };
}

/** Advance the world by `dt` seconds (split into steps of at most 1/120 s). */
export function step(bodies: readonly Body[], world: World, dt: number): void {
  // A frame whose clock did not advance would divide by zero and leave NaN in every body it touched.
  if (!(dt > 0)) return;
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
  const moved = new Map<Body, { readonly x: number; readonly y: number }>();
  const grounded = new Set<Body>();
  const landed = new Set<Body>();
  for (const body of bodies) {
    if (body.mode === 'hidden') continue;
    if (body.mode === 'absorbing') {
      // A damped spring toward the sink, shrinking on the way, swallowed on arrival.
      const sink = body.target ?? world.sink;
      const dx = sink.x - body.x;
      const dy = sink.y - body.y;
      body.vx = (body.vx + dx * 90 * dt) * Math.exp(-9 * dt);
      body.vy = (body.vy + dy * 90 * dt) * Math.exp(-9 * dt);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.scale += (ABSORBED_SCALE - body.scale) * Math.min(1, 7 * dt);
      if (body.angle !== undefined) body.angle *= Math.exp(-8 * dt);
      if (Math.hypot(dx, dy) < SWALLOW_DISTANCE) body.mode = 'hidden';
      // Whatever it was doing on the floor is over: let go mid-flight, it falls as a body that has just been thrown.
      body.ghost = 0;
      body.settle = 0;
      body.settleFor = 0;
      body.still = 0;
      continue;
    }
    free.push(body);
    before.set(body, { x: body.x, y: body.y });
    if (body.escape !== undefined && body.escape > 0) body.escape = Math.max(0, body.escape - dt);
    if (body.ghost !== undefined && body.ghost > 0) {
      body.ghost = Math.max(0, body.ghost - dt);
      if (body.ghost === 0) {
        body.settle = SETTLE_AFTER_GHOST;
        body.settleFor = SETTLE_AT_MOST;
      }
    } else if (body.settle !== undefined && body.settle > 0) {
      body.settle = Math.max(0, body.settle - dt);
      body.settleFor = Math.max(0, (body.settleFor ?? 0) - dt);
    }
    body.scale += (1 - body.scale) * Math.min(1, 10 * dt);
    // Resting stops gravity, so a body whose support was taken away (gathered into the digest, dragged off) would hang in the air.
    if (!body.held && body.still >= SLEEP_AFTER && !supported(body, bodies, world)) rouse(body);
    if (body.held || body.still >= SLEEP_AFTER) continue;
    body.vy += GRAVITY * dt;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > MAX_SPEED) {
      body.vx *= MAX_SPEED / speed;
      body.vy *= MAX_SPEED / speed;
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    moved.set(body, { x: body.x, y: body.y });
    if (body.spin !== undefined && body.spin !== 0) {
      body.angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, (body.angle ?? 0) + body.spin * dt));
      if (Math.abs(body.angle) >= MAX_TILT) body.spin *= -0.4;
    }
  }

  for (let i = 0; i < ITERATIONS; i++) {
    for (let a = 0; a < free.length; a++) {
      const first = free[a];
      if (first === undefined) continue;
      for (let b = a + 1; b < free.length; b++) {
        const second = free[b];
        if (second !== undefined) separate(first, second, grounded, landed);
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
    // Its own motion, plus what pushing it out of overlaps added, the push capped: a deep overlap resolved in one substep would otherwise launch it off the page.
    const own = moved.get(body) ?? start;
    let cx = (body.x - own.x) / dt;
    let cy = (body.y - own.y) / dt;
    if ((body.settle ?? 0) > 0) {
      // Settling: what holding it up took cancels its fall, but no push moves it further than a drift, its position as well as its speed, or the overlap opens in a frame and the card snaps elsewhere; its own flight it keeps, and the floor and words still win.
      const drift = SETTLE_SPEED * dt;
      body.x = Math.max(own.x - drift, Math.min(own.x + drift, body.x));
      body.y = Math.max(start.y + Math.min(own.y - start.y, -drift), Math.min(own.y + drift, body.y));
      for (const obstacle of world.obstacles) pushOut(body, obstacle, grounded);
      bound(body, world, grounded);
      body.vx = (body.x - start.x) / dt;
      body.vy = (body.y - start.y) / dt;
    } else {
      const correction = Math.hypot(cx, cy);
      if (correction > CORRECTION_SPEED) {
        cx *= CORRECTION_SPEED / correction;
        cy *= CORRECTION_SPEED / correction;
      }
      const ownVx = (own.x - start.x) / dt;
      const ownVy = (own.y - start.y) / dt;
      body.vx = ownVx + cx;
      body.vy = ownVy + cy;
      if ((body.escape ?? 0) > 0) {
        // Coming out of the words: a push stops its motion into them and adds a light bounce at most, or the pushes stacked up and launched it.
        body.vx = Math.max(Math.min(ownVx, -ESCAPE_BOUNCE), Math.min(Math.max(ownVx, ESCAPE_BOUNCE), body.vx));
        body.vy = Math.max(Math.min(ownVy, -ESCAPE_BOUNCE), Math.min(Math.max(ownVy, ESCAPE_BOUNCE), body.vy));
      }
    }
    if (grounded.has(body)) {
      body.vx *= FRICTION;
      if ((body.ghost ?? 0) > 0) landed.add(body);
      if (body.spin !== undefined) body.spin *= 0.5;
    }
    // A card from the explosion stays where it first comes down, as it landed: the heap is already a heap of papers, and untangling it afterwards only read as cards rising and shoving each other for seconds.
    if (landed.has(body)) {
      body.ghost = 0;
      body.settle = 0;
      body.settleFor = 0;
      body.vx = 0;
      body.vy = 0;
      body.spin = 0;
      body.still = SLEEP_AFTER;
      continue;
    }
    if (body.spin !== undefined && Math.abs(body.spin) < 0.05) body.spin = 0;
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
  const r = boundsOf(body);
  const left = body.fence?.left ?? 0;
  const right = Math.min(body.fence?.right ?? world.width, world.width);
  if (r.left < left) body.x += escaping(body, left - r.left);
  else if (r.right > right) body.x -= escaping(body, r.right - right);
  if (r.bottom > world.floor) {
    body.y -= escaping(body, r.bottom - world.floor);
    grounded.add(body);
  }
}

/** How much of a push out of the words or walls a body takes now: all of it, or a little while it is escaping, which lasts until it is clear. */
function escaping(body: Body, depth: number): number {
  if ((body.escape ?? 0) <= 0 || depth <= ESCAPE_STEP) return depth;
  body.escape = Math.max(body.escape ?? 0, 0.1);
  return ESCAPE_STEP;
}

/** Push a body out of a fixed rectangle along the shallower axis. */
function pushOut(body: Body, obstacle: Rect, grounded: Set<Body>): void {
  const r = boundsOf(body);
  const ox = Math.min(r.right, obstacle.right) - Math.max(r.left, obstacle.left);
  const oy = Math.min(r.bottom, obstacle.bottom) - Math.max(r.top, obstacle.top);
  if (ox <= 0 || oy <= 0) return;
  if (ox < oy) {
    const amount = escaping(body, ox);
    body.x += body.x < (obstacle.left + obstacle.right) / 2 ? -amount : amount;
  } else if (body.y < (obstacle.top + obstacle.bottom) / 2) {
    body.y -= escaping(body, oy);
    grounded.add(body);
    // Resting with its middle past the edge: it slides off, since a box that cannot tip would balance there forever.
    if (body.x < obstacle.left) body.x -= SPILL;
    else if (body.x > obstacle.right) body.x += SPILL;
  } else {
    body.y += escaping(body, oy);
  }
}

/** The part of a body other bodies cannot overlap. */
export function coreOf(body: Body): Rect {
  const r = rectOf(body);
  const dx = ((r.right - r.left) * (1 - NESTLE_X)) / 2;
  const dy = ((r.bottom - r.top) * (1 - NESTLE_Y)) / 2;
  return { left: r.left + dx, top: r.top + dy, right: r.right - dx, bottom: r.bottom - dy };
}

/** Wake a resting body, gently unless the pointer is shoving it: a card roused inside a tangle and pushed at full strength shoved the heap apart. */
function rouse(body: Body, gently = true): void {
  body.still = 0;
  if (!gently) return;
  body.settle = SETTLE_AFTER_GHOST;
  body.settleFor = SETTLE_AT_MOST;
}

/** Whether something is under a body to hold it up: the floor, an obstacle's top, or another body it rests on. */
function supported(body: Body, bodies: readonly Body[], world: World): boolean {
  const r = boundsOf(body);
  if (r.bottom >= world.floor - TOUCH) return true;
  for (const obstacle of world.obstacles) {
    if (r.right > obstacle.left && r.left < obstacle.right && r.bottom >= obstacle.top - TOUCH && r.top < obstacle.top) return true;
  }
  const core = coreOf(body);
  for (const other of bodies) {
    if (other === body || other.mode !== 'free') continue;
    const under = coreOf(other);
    if (core.right > under.left && core.left < under.right && core.bottom >= under.top - TOUCH && core.top < under.top) return true;
  }
  return false;
}

/** Separate two overlapping bodies; a held body does not move, so the other takes all of it. */
function separate(a: Body, b: Body, grounded: Set<Body>, landed: Set<Body>): void {
  const ra = coreOf(a);
  const rb = coreOf(b);
  const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  if (ox <= 0 || oy <= 0) return;
  if (a.held && b.held) return;
  // Two resting bodies are a heap of papers, left overlapping however they came to rest: prying them apart only ever reads as the heap shaking.
  if (!a.held && !b.held && a.still >= SLEEP_AFTER && b.still >= SLEEP_AFTER) return;
  const slow = !a.held && !b.held && Math.hypot(a.vx - b.vx, a.vy - b.vy) < CONTACT_SPEED;
  if ((a.ghost ?? 0) > 0 && (b.ghost ?? 0) > 0) return;
  // A card in flight comes down on one already down and stays there; on its way up, or launched from inside the heap, it passes through.
  let lander: Body | null = null;
  for (const [flying, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if ((flying.ghost ?? 0) <= 0) continue;
    if (flying.vy <= 0 || flying.y > other.y || oy > LAND_DEPTH) return;
    flying.ghost = 0;
    landed.add(flying);
    lander = flying;
  }
  // Landed this step, it stays as it came down: still deep in a card it was passing through, it would otherwise pop out of it at once.
  if (lander === null && (landed.has(a) || landed.has(b))) return;
  const settling = (a.settle ?? 0) > 0 || (b.settle ?? 0) > 0;
  const gentle = settling ? SETTLE_SHARE : 1;
  // Still tangled: both keep settling until they are apart, so the last of a heap never comes apart at full strength.
  if (settling && Math.min(ox, oy) > 4) {
    if (!a.held && (a.settleFor ?? 0) > 0) a.settle = Math.max(a.settle ?? 0, 0.25);
    if (!b.held && (b.settleFor ?? 0) > 0) b.settle = Math.max(b.settle ?? 0, 0.25);
  }
  // A resting body pushed by a moving one takes none of the push, so a pile stays put under a single landing; side by side, sharing it woke the neighbour, which woke the next, for as long as the walls kept them overlapping.
  const aRests = a.held || a.still >= SLEEP_AFTER;
  const bRests = b.held || b.still >= SLEEP_AFTER;
  let share = a.held ? 0 : b.held ? 1 : aRests && !bRests ? 0 : bRests && !aRests ? 1 : 0.5;
  if (ox < oy) {
    if (lander !== null) share = lander === a ? 1 : 0;
    const sign = a.x < b.x ? -1 : 1;
    const amount = ox * gentle;
    a.x += sign * amount * share;
    b.x -= sign * amount * (1 - share);
  } else {
    const sign = a.y < b.y ? -1 : 1;
    // What lies underneath stays put and the one on top gives way, so nothing is pressed down into what holds it up; one rising slowly lifts what rests on it rather than being squeezed under it.
    if (!a.held && !b.held && (aRests || bRests)) {
      const lowerRests = sign < 0 ? bRests : aRests;
      if (lowerRests) share = sign < 0 ? 1 : 0;
      else if (slow) share = 0.5;
    }
    // Landing on a card is landing on the floor: the one underneath does not give, or it was shoved down tens of pixels a frame.
    if (lander !== null) share = lander === a ? 1 : 0;
    const amount = oy * gentle;
    a.y += sign * amount * share;
    b.y -= sign * amount * (1 - share);
    const upper = sign < 0 ? a : b;
    const lower = sign < 0 ? b : a;
    grounded.add(upper);
    if (!upper.held) {
      const support = rectOf(lower);
      if (upper.x < support.left) upper.x -= SPILL;
      else if (upper.x > support.right) upper.x += SPILL;
    }
  }
  // A resting body that actually got moved (by the pointer, or by another resting body) wakes.
  const push = Math.min(ox, oy);
  if (aRests && !a.held && push * share > 0.5) rouse(a, !b.held);
  if (bRests && !b.held && push * (1 - share) > 0.5) rouse(b, !a.held);
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
