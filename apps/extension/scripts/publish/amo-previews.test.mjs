import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import { difference, SAME_IMAGE, signature, syncPreviews } from './amo-previews-sync.mjs';

/** A 1280x800 stand-in for a listing screenshot: a white page of grey text lines laid out by `seed`, as GitHub's pages are. */
async function screenshot(seed) {
  let rows = '';
  for (let line = 0; line < 30; line += 1) {
    const width = 200 + ((seed * 97 + line * 53) % 900);
    const x = 40 + ((seed * 31 + line * 17) % 120);
    rows += `<rect x="${x}" y="${40 + line * 24}" width="${width}" height="10" fill="#57606a"/>`;
  }
  const block = `<rect x="${100 + seed * 40}" y="${200 + seed * 30}" width="320" height="140" fill="#d1242f" fill-opacity="0.3"/>`;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="1280" height="800" fill="#fff"/>${rows}${block}</svg>`)).jpeg({ quality: 90 }).toBuffer();
}

/** What AMO serves back: its own re-encoding of the upload. */
const reencode = (bytes) => sharp(bytes).jpeg({ quality: 70 }).toBuffer();

/** A fake AMO: previews by id, and every write it was sent. */
function store(previews) {
  const state = { previews: previews.map((preview) => ({ ...preview })), writes: [], next: 100 };
  return {
    state,
    options: (images) => ({
      existing: state.previews.map(({ id, position }) => ({ id, position })),
      images,
      read: async (preview) => state.previews.find((p) => p.id === preview.id).bytes,
      upload: async (image, position) => {
        const id = state.next++;
        state.previews.push({ id, position, bytes: await reencode(image.bytes) });
        state.writes.push(['upload', image.name, position]);
        return id;
      },
      move: async (id, position) => {
        state.previews.find((p) => p.id === id).position = position;
        state.writes.push(['move', id, position]);
      },
    }),
  };
}

describe('preview signatures', () => {
  it('take a re-encoded copy for the same image and a different screenshot for a different one', async () => {
    const shots = await Promise.all([1, 2, 3, 4].map(screenshot));
    for (const [index, shot] of shots.entries()) {
      const own = await signature(shot);
      for (const copy of [await reencode(shot), await sharp(shot).png().toBuffer()]) assert.ok(difference(own, await signature(copy)) < SAME_IMAGE / 2);
      for (const other of shots.filter((_, i) => i !== index)) assert.ok(difference(own, await signature(other)) > SAME_IMAGE * 2);
    }
  });
});

describe('syncPreviews', () => {
  it('uploads a new screenshot first and moves the others after it, then does nothing on a second run', async () => {
    const [a, b, c, fresh] = await Promise.all([1, 2, 3, 4].map(screenshot));
    const amo = store([
      { id: 11, position: 0, bytes: await reencode(a) },
      { id: 12, position: 1, bytes: await reencode(b) },
      { id: 13, position: 2, bytes: await reencode(c) },
    ]);
    const order = await syncPreviews(amo.options([{ name: 'new.jpg', bytes: fresh }]));
    assert.deepEqual(order, [100, 11, 12, 13]);
    assert.deepEqual(amo.state.writes, [
      ['upload', 'new.jpg', 0],
      ['move', 11, 1],
      ['move', 12, 2],
      ['move', 13, 3],
    ]);

    amo.state.writes.length = 0;
    assert.deepEqual(await syncPreviews(amo.options([{ name: 'new.jpg', bytes: fresh }])), [100, 11, 12, 13]);
    assert.deepEqual(amo.state.writes, []);
  });

  it('moves a screenshot AMO already has to the front instead of uploading it again', async () => {
    const [a, b] = await Promise.all([1, 2].map(screenshot));
    const amo = store([
      { id: 11, position: 0, bytes: await reencode(a) },
      { id: 12, position: 1, bytes: await reencode(b) },
    ]);
    assert.deepEqual(await syncPreviews(amo.options([{ name: 'b.jpg', bytes: b }])), [12, 11]);
    assert.deepEqual(amo.state.writes, [
      ['move', 12, 0],
      ['move', 11, 1],
    ]);
  });
});
