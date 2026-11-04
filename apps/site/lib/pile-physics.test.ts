import { describe, expect, it } from 'vitest';

import type { Body, Rect, World } from './pile-physics';
import { coreOf, rectOf, seeded, settled, step } from './pile-physics';

function body(x: number, y: number, w = 120, h = 24): Body {
  return { x, y, vx: 0, vy: 0, w, h, scale: 1, mode: 'free', held: false, still: 0 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
}

function run(bodies: readonly Body[], world: World, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) step(bodies, world, 1 / 60);
}

const headline: Rect = { left: 200, top: 300, right: 700, bottom: 360 };
const world: World = { width: 900, floor: 600, obstacles: [headline], sink: { x: 850, y: 580 } };

describe('the pile', () => {
  it('drops a crowd of boxes into a resting pile above the floor, clear of the obstacles, few of them overlapping past their edges', () => {
    const random = seeded(7);
    const bodies = Array.from({ length: 28 }, () => body(60 + random() * 780, -40 - random() * 600, 80 + random() * 80));
    run(bodies, world, 6);
    expect(settled(bodies)).toBe(true);
    for (const b of bodies) {
      const r = rectOf(b);
      expect(r.bottom).toBeLessThanOrEqual(world.floor + 0.5);
      expect(r.left).toBeGreaterThanOrEqual(-0.5);
      expect(r.right).toBeLessThanOrEqual(world.width + 0.5);
      expect(overlaps(r, headline)).toBe(false);
    }
    let crossings = 0;
    for (let a = 0; a < bodies.length; a++) {
      for (let c = a + 1; c < bodies.length; c++) {
        const first = bodies[a];
        const second = bodies[c];
        if (first && second && overlaps(coreOf(first), coreOf(second))) crossings++;
      }
    }
    expect(crossings).toBeLessThanOrEqual(2);
  });

  it('lands a box on top of an obstacle in its path', () => {
    const falling = body(450, 100);
    run([falling], world, 2);
    expect(rectOf(falling).bottom).toBeCloseTo(headline.top, 0);
  });

  it('draws absorbing boxes into the sink and swallows them', () => {
    const bodies = [body(100, 100), body(400, 500)];
    for (const b of bodies) b.mode = 'absorbing';
    run(bodies, world, 2);
    expect(bodies.every((b) => b.mode === 'hidden')).toBe(true);
  });

  it('draws an absorbing box with a target of its own there, not to the sink', () => {
    const b = body(100, 100);
    b.mode = 'absorbing';
    b.target = { x: 300, y: 200 };
    for (let t = 0; t < 2 && b.mode === 'absorbing'; t += 1 / 120) step([b], world, 1 / 120);
    expect(b.mode).toBe('hidden');
    expect(Math.hypot(b.x - 300, b.y - 200)).toBeLessThan(12);
  });

  it('lets tumbling boxes land tilted, and stop turning once they rest', () => {
    const random = seeded(11);
    const bodies = Array.from({ length: 10 }, (_, i) => ({
      ...body(100 + random() * 700, -60 - i * 70, 150, 40),
      vx: (random() - 0.5) * 400,
      vy: 400,
      angle: (random() - 0.5) * 0.8,
      spin: (random() - 0.5) * 10,
    }));
    run(bodies, { ...world, obstacles: [] }, 8);
    expect(settled(bodies)).toBe(true);
    for (const b of bodies) {
      expect(b.spin).toBe(0);
      expect(Math.abs(b.angle ?? 0)).toBeLessThanOrEqual(0.45);
    }
    expect(bodies.some((b) => Math.abs(b.angle ?? 0) > 0.1)).toBe(true);
  });

  it('eases a heap that landed tangled apart, instead of erupting, once its boxes stop passing through each other', () => {
    const random = seeded(5);
    const bodies = Array.from({ length: 12 }, () => ({ ...body(300 + random() * 300, 540 + random() * 50, 150, 40), ghost: 0.05 }));
    let fastest = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      step(bodies, { ...world, obstacles: [] }, 1 / 60);
      for (const b of bodies) fastest = Math.max(fastest, -b.vy);
    }
    expect(fastest).toBeLessThan(400);
    run(bodies, { ...world, obstacles: [] }, 6);
    expect(settled(bodies)).toBe(true);
  });

  it('ignores a step whose clock did not advance, rather than filling the world with NaN', () => {
    const b = body(450, 100);
    b.vx = 50;
    step([b], world, 0);
    step([b], world, -0.01);
    expect(b.x).toBe(450);
    expect(Number.isFinite(b.vx) && Number.isFinite(b.vy)).toBe(true);
  });

  it('keeps a fenced box inside the world when the world is narrower than its fence', () => {
    const b = { ...body(880, 580), fence: { left: 600, right: 1200 } };
    run([b], world, 1);
    expect(rectOf(b).right).toBeLessThanOrEqual(world.width + 0.5);
  });

  it('never moves a held box, and pushes the others out of its way', () => {
    const held = body(450, 580);
    held.held = true;
    const other = body(460, 560);
    run([held, other], world, 1);
    expect(held.x).toBe(450);
    expect(held.y).toBe(580);
    expect(overlaps(coreOf(held), coreOf(other))).toBe(false);
  });

  it('slides a box off a ledge it overhangs, rather than balancing it there', () => {
    const ledge: Rect = { left: 300, top: 400, right: 500, bottom: 460 };
    const overhanging = body(520, 380);
    run([overhanging], { ...world, obstacles: [ledge] }, 4);
    expect(rectOf(overhanging).bottom).toBeCloseTo(world.floor, 0);
  });

  it('drops a resting box whose support is gathered away, instead of leaving it in the air', () => {
    const open = { ...world, obstacles: [] };
    const under = body(450, 580);
    const over = body(450, 550);
    run([under, over], open, 3);
    expect(settled([under, over])).toBe(true);
    expect(rectOf(over).bottom).toBeLessThan(world.floor - 10);
    under.mode = 'absorbing';
    run([under, over], open, 2);
    expect(rectOf(over).bottom).toBeCloseTo(world.floor, 0);
    expect(settled([over])).toBe(true);
  });

  it('flies at full speed when let go on its way into the sink, whatever it was doing before', () => {
    const b = { ...body(450, 500), settle: 1, settleFor: 2 };
    b.mode = 'absorbing';
    step([b], world, 1 / 60);
    b.mode = 'free';
    b.vy = -1500;
    const from = b.y;
    run([b], { ...world, obstacles: [] }, 0.2);
    expect(from - b.y).toBeGreaterThan(150);
  });

  it('brings a landed heap to rest for good, with nothing still twitching once it has slept', () => {
    const random = seeded(9);
    const open = { ...world, obstacles: [] };
    const bodies = Array.from({ length: 16 }, () => ({ ...body(250 + random() * 400, 100 + random() * 300, 150, 40), vx: (random() - 0.5) * 600, ghost: 0.3, angle: (random() - 0.5) * 0.6, spin: (random() - 0.5) * 12 }));
    run(bodies, open, 6);
    expect(settled(bodies)).toBe(true);
    const at = bodies.map((b) => [b.x, b.y]);
    run(bodies, open, 2);
    bodies.forEach((b, i) => expect(Math.hypot(b.x - (at[i]?.[0] ?? 0), b.y - (at[i]?.[1] ?? 0))).toBe(0));
  });

  it('carries a thrown box sideways until friction stops it', () => {
    const thrown = body(100, 580);
    thrown.vx = 900;
    run([thrown], { ...world, obstacles: [] }, 3);
    expect(thrown.x).toBeGreaterThan(200);
    expect(settled([thrown])).toBe(true);
  });
});
