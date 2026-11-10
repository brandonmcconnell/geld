// Which listing screenshots ("previews") to upload, and where each goes, for amo-previews.mjs.
//
// An image is recognised by its pixels, not its size (every listing screenshot is
// 1280x800): both sides are reduced to a 160x100 greyscale thumbnail and compared,
// since AMO stores its own re-encoded copy. The given images become the first
// previews in their order; the other previews keep their order after them.
import sharp from 'sharp';

/** Mean difference (0 to 255): re-encoded copies measured under 0.3, the listing's different screenshots over 2.2. */
export const SAME_IMAGE = 1;

export const signature = (bytes) => sharp(bytes).resize(160, 100, { fit: 'fill' }).greyscale().raw().toBuffer();

export const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;

/**
 * @param {object} options
 * @param {{ id: number, position: number }[]} options.existing AMO's previews.
 * @param {{ name: string, bytes: Buffer }[]} options.images The committed screenshots, in order.
 * @param {(preview: { id: number }) => Promise<Buffer>} options.read The bytes of one of AMO's previews.
 * @param {(image: { name: string, bytes: Buffer }, position: number) => Promise<number>} options.upload Uploads, answering the new id.
 * @param {(id: number, position: number) => Promise<void>} options.move
 * @param {(line: string) => void} [options.log]
 */
export async function syncPreviews({ existing, images, read, upload, move, log = () => {} }) {
  const sorted = existing.toSorted((a, b) => a.position - b.position);
  const signatures = new Map();
  for (const preview of sorted) signatures.set(preview.id, await signature(await read(preview)));

  const ordered = [];
  const positions = new Map(sorted.map((preview) => [preview.id, preview.position]));
  for (const image of images) {
    const own = await signature(image.bytes);
    const match = sorted.find((preview) => !ordered.includes(preview.id) && difference(own, signatures.get(preview.id)) < SAME_IMAGE);
    if (match) {
      log(`${image.name}: already there (id ${match.id}).`);
      ordered.push(match.id);
      continue;
    }
    const id = await upload(image, ordered.length);
    log(`${image.name}: uploaded (id ${id}).`);
    positions.set(id, ordered.length);
    ordered.push(id);
  }

  const order = [...ordered, ...sorted.map((preview) => preview.id).filter((id) => !ordered.includes(id))];
  for (const [position, id] of order.entries()) {
    if (positions.get(id) === position) continue;
    await move(id, position);
    log(`Preview ${id}: position ${position}.`);
  }
  return order;
}
