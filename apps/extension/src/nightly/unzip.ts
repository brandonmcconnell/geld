import { readZip } from '@geld/core/nightly';
import type { ZipEntry } from '@geld/core/nightly';

/** The core zip reader (@geld/core/nightly) with the browser's own inflater. */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  return readZip(bytes, { inflate, decode });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
