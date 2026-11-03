import { describe, expect, it } from 'vitest';

import type { Body, Rect, World } from './pile-physics';
import { rectOf, seeded, settled, step } from './pile-physics';

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
  it('drops a crowd of boxes into a resting pile above the floor, clear of the obstacles and of each other', () => {
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
        if (first && second && overlaps(rectOf(first), rectOf(second))) crossings++;
      }
    }
    expect(crossings).toBe(0);
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

  it('never moves a held box, and pushes the others out of its way', () => {
    const held = body(450, 580);
    held.held = true;
    const other = body(460, 560);
    run([held, other], world, 1);
    expect(held.x).toBe(450);
    expect(held.y).toBe(580);
    expect(overlaps(rectOf(held), rectOf(other))).toBe(false);
  });

  it('carries a thrown box sideways until friction stops it', () => {
    const thrown = body(100, 580);
    thrown.vx = 900;
    run([thrown], { ...world, obstacles: [] }, 3);
    expect(thrown.x).toBeGreaterThan(200);
    expect(settled([thrown])).toBe(true);
  });
});
