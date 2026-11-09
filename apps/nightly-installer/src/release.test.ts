import { deflateRawSync } from 'node:zlib';
import { crc32 } from '@geld/core/nightly';
import { pickBuild, sha256, verifiedEntries } from './release';

function zip(files: Readonly<Record<string, string>>): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = new TextEncoder().encode(path);
    const data = new TextEncoder().encode(text);
    const body = new Uint8Array(deflateRawSync(data));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc32(data), true);
    local.setUint32(18, body.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc32(data), true);
    central.setUint32(20, body.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const size = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, centrals.length / 2, true);
  end.setUint16(10, centrals.length / 2, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

const asset = (name: string, uploader = 'github-actions[bot]') => ({ name, size: 1, uploader: { login: uploader }, browser_download_url: `https://github.com/brandonmcconnell/geld/releases/download/v0.1.2-build.3270/${name}` });
const release = (assets: readonly unknown[]) => ({ tag_name: 'v0.1.2-build.3270', draft: false, prerelease: false, assets });
const both = [asset('geld-0.1.2.3270-chrome-nightly.zip'), asset('geld-0.1.2.3270-chrome-nightly.zip.sha256')];

describe('pickBuild', () => {
  it('takes the build the extension would take', () => {
    expect(pickBuild(release(both), 'chrome').assetName).toBe('geld-0.1.2.3270-chrome-nightly.zip');
  });

  it('refuses what the extension refuses', () => {
    expect(() => pickBuild({ ...release(both), draft: true }, 'chrome')).toThrow('no chrome nightly build');
    expect(() => pickBuild({ ...release(both), prerelease: true }, 'chrome')).toThrow();
    expect(() => pickBuild(release([asset('geld-0.1.2.3270-chrome-nightly.zip', 'someone'), both[1]]), 'chrome')).toThrow();
    expect(() => pickBuild(release([{ ...both[0], browser_download_url: 'https://example.com/x.zip' }, both[1]]), 'chrome')).toThrow();
    expect(() => pickBuild(release(both.slice(0, 1)), 'chrome')).toThrow();
    expect(() => pickBuild(release(both), 'edge')).toThrow('no edge nightly build');
  });
});

describe('verifiedEntries', () => {
  const build = pickBuild(release(both), 'chrome');
  const good = zip({ 'manifest.json': '{"name":"Geld Nightly","version":"0.1.2.3270"}', 'nightly.html': '' });
  const sums = (bytes: Uint8Array) => `${sha256(bytes)}  geld-0.1.2.3270-chrome-nightly.zip\n`;

  it('unzips a build that matches its checksum and manifest', async () => {
    expect((await verifiedEntries(build, good, sums(good))).map((entry) => entry.path)).toEqual(['manifest.json', 'nightly.html']);
  });

  it('refuses a zip that does not match its checksum', async () => {
    await expect(verifiedEntries(build, good, `${'0'.repeat(64)}  geld-0.1.2.3270-chrome-nightly.zip`)).rejects.toThrow('does not match its published checksum');
    await expect(verifiedEntries(build, good, 'Not Found')).rejects.toThrow('names no checksum');
  });

  it('refuses a store build or another version, even with a matching checksum', async () => {
    const store = zip({ 'manifest.json': '{"name":"Geld","version":"0.1.2.3270"}', 'nightly.html': '' });
    await expect(verifiedEntries(build, store, sums(store))).rejects.toThrow('not a Geld Nightly build');
    const older = zip({ 'manifest.json': '{"name":"Geld Nightly","version":"0.1.2.3269"}', 'nightly.html': '' });
    await expect(verifiedEntries(build, older, sums(older))).rejects.toThrow('0.1.2.3269');
  });
});
