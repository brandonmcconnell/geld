/**
 * Reads the zips WXT writes: stored or deflated entries, no zip64, no
 * encryption. Each entry's CRC is checked, and a path that could reach
 * outside the folder it is written to is refused.
 */

export interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isSafePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function endOfCentralDirectory(view: DataView): number {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  throw new Error('Not a zip file');
}

export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('Damaged zip directory');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new Error(`Encrypted zip entry: ${path}`);
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error('Zip64 is not supported');
    if (!isSafePath(path)) throw new Error(`Unsafe path in zip: ${path}`);
    if (view.getUint32(local, true) !== LOCAL) throw new Error(`Damaged zip entry: ${path}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw);
    else throw new Error(`Unsupported zip compression ${method}: ${path}`);
    if (data.byteLength !== size || crc32(data) !== crc) throw new Error(`Corrupt zip entry: ${path}`);
    entries.push({ path, data });
  }
  return entries;
}
