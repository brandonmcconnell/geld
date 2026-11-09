import { deflateRawSync } from 'node:zlib';
import { buildOf, compareVersions, parseRelease } from './release';
import { buildProblem, parseFileList, stalePaths, writeOrder } from './build-check';
import { crc32, isSafePath, unzip } from './unzip';

interface FileSpec {
  readonly path: string;
  readonly text: string;
  readonly stored?: boolean;
}

function zip(files: readonly FileSpec[], corrupt = false): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.text);
    const body = file.stored === true ? data : new Uint8Array(deflateRawSync(data));
    const crc = corrupt ? crc32(data) ^ 1 : crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, file.stored === true ? 0 : 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    locals.push(new Uint8Array(local.buffer), name, body);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, file.stored === true ? 0 : 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

const release = {
  tag_name: 'v0.1.2-build.3270',
  draft: false,
  prerelease: false,
  published_at: '2026-11-09T09:27:39Z',
  html_url: 'https://github.com/brandonmcconnell/geld/releases/tag/v0.1.2-build.3270',
  assets: [
    { name: 'geld-0.1.2.3270-chrome.zip', browser_download_url: 'https://github.com/brandonmcconnell/geld/releases/download/v0.1.2-build.3270/geld-0.1.2.3270-chrome.zip', size: 10, uploader: { login: 'github-actions[bot]' } },
    { name: 'geld-0.1.2.3270-chrome-nightly.zip', browser_download_url: 'https://github.com/brandonmcconnell/geld/releases/download/v0.1.2-build.3270/geld-0.1.2.3270-chrome-nightly.zip', size: 20, uploader: { login: 'github-actions[bot]' } },
  ],
};

describe('parseRelease', () => {
  it('reads the nightly asset of a CI release', () => {
    expect(parseRelease(release, 'chrome')).toEqual({
      tag: 'v0.1.2-build.3270',
      version: '0.1.2.3270',
      build: 3270,
      assetName: 'geld-0.1.2.3270-chrome-nightly.zip',
      assetUrl: 'https://github.com/brandonmcconnell/geld/releases/download/v0.1.2-build.3270/geld-0.1.2.3270-chrome-nightly.zip',
      size: 20,
      publishedAt: '2026-11-09T09:27:39Z',
      htmlUrl: 'https://github.com/brandonmcconnell/geld/releases/tag/v0.1.2-build.3270',
    });
  });

  it('takes the build for its own browser', () => {
    const edge = { ...release.assets[1], name: 'geld-0.1.2.3270-edge-nightly.zip', browser_download_url: 'https://github.com/brandonmcconnell/geld/releases/download/v0.1.2-build.3270/geld-0.1.2.3270-edge-nightly.zip' };
    expect(parseRelease({ ...release, assets: [...release.assets, edge] }, 'edge')?.assetName).toBe('geld-0.1.2.3270-edge-nightly.zip');
    expect(parseRelease(release, 'edge')).toBeNull();
  });

  it('ignores releases from before nightly builds were published', () => {
    expect(parseRelease({ ...release, assets: release.assets.slice(0, 1) }, 'chrome')).toBeNull();
  });

  it('refuses an asset CI did not upload', () => {
    const assets = release.assets.map((asset) => ({ ...asset, uploader: { login: 'someone' } }));
    expect(parseRelease({ ...release, assets }, 'chrome')).toBeNull();
  });

  it('refuses a download from anywhere but this repository', () => {
    const assets = release.assets.map((asset) => ({ ...asset, browser_download_url: 'https://example.com/geld.zip' }));
    expect(parseRelease({ ...release, assets }, 'chrome')).toBeNull();
  });

  it('ignores drafts, prereleases and other tags', () => {
    expect(parseRelease({ ...release, draft: true }, 'chrome')).toBeNull();
    expect(parseRelease({ ...release, prerelease: true }, 'chrome')).toBeNull();
    expect(parseRelease({ ...release, tag_name: 'v0.1.2' }, 'chrome')).toBeNull();
    expect(parseRelease(null, 'chrome')).toBeNull();
  });
});

describe('versions', () => {
  it('compares part by part', () => {
    expect(compareVersions('0.1.2.3270', '0.1.2.3267')).toBe(1);
    expect(compareVersions('0.1.2.3267', '0.1.3.1')).toBe(-1);
    expect(compareVersions('0.1.2', '0.1.2.0')).toBe(0);
    expect(compareVersions('0.1.10.1', '0.1.9.900')).toBe(1);
  });

  it('reads the build number', () => {
    expect(buildOf('0.1.2.3270')).toBe(3270);
    expect(buildOf('0.1.2')).toBeNull();
  });
});

describe('unzip', () => {
  it('reads stored and deflated entries', async () => {
    const entries = await unzip(zip([
      { path: 'manifest.json', text: '{"name":"Geld Nightly"}' },
      { path: 'chunks/a.js', text: 'console.log(1)'.repeat(50), stored: true },
    ]));
    expect(entries.map((entry) => [entry.path, new TextDecoder().decode(entry.data).slice(0, 23)])).toEqual([
      ['manifest.json', '{"name":"Geld Nightly"}'],
      ['chunks/a.js', 'console.log(1)console.l'],
    ]);
  });

  it('refuses a corrupt entry', async () => {
    await expect(unzip(zip([{ path: 'a.js', text: 'x' }], true))).rejects.toThrow('Corrupt zip entry');
  });

  it('refuses paths that leave the folder', async () => {
    await expect(unzip(zip([{ path: '../evil.js', text: 'x' }]))).rejects.toThrow('Unsafe path');
    expect(isSafePath('a/../b')).toBe(false);
    expect(isSafePath('/etc/passwd')).toBe(false);
    expect(isSafePath('a\\b')).toBe(false);
    expect(isSafePath('_locales/en/messages.json')).toBe(true);
  });

  it('refuses what is not a zip', async () => {
    await expect(unzip(new TextEncoder().encode('<html>Sign in</html>'.repeat(3)))).rejects.toThrow('Not a zip');
  });
});

describe('buildProblem', () => {
  const entry = (path: string, text: string) => ({ path, data: new TextEncoder().encode(text) });

  it('accepts the nightly build it expects', () => {
    expect(buildProblem([entry('manifest.json', '{"name":"Geld Nightly","version":"0.1.2.3270"}'), entry('nightly.html', '')], '0.1.2.3270')).toBeNull();
  });

  it('refuses a store build, another version, or no manifest', () => {
    expect(buildProblem([entry('manifest.json', '{"name":"Geld","version":"0.1.2.3270"}'), entry('nightly.html', '')], '0.1.2.3270')).toMatch('not a Geld Nightly');
    expect(buildProblem([entry('manifest.json', '{"name":"Geld Nightly","version":"0.1.2.3269"}'), entry('nightly.html', '')], '0.1.2.3270')).toMatch('0.1.2.3269');
    expect(buildProblem([entry('manifest.json', '{"name":"Geld Nightly","version":"0.1.2.3270"}')], '0.1.2.3270')).toMatch('not a Geld Nightly');
    expect(buildProblem([], '0.1.2.3270')).toMatch('no manifest');
  });
});

describe('stalePaths', () => {
  it('removes what the new build dropped and keeps hidden files and Chrome metadata', () => {
    expect(stalePaths(
      ['manifest.json', 'chunks/old-123.js', 'chunks/new-456.js', '.DS_Store', '_metadata/verified_contents.json', 'a/.git/HEAD'],
      ['manifest.json', 'chunks/new-456.js'],
    )).toEqual(['chunks/old-123.js']);
  });
});

describe('writeOrder', () => {
  it('writes new files first and the manifest last', () => {
    const entries = ['manifest.json', 'background.js', 'chunks/new-2.js', 'popup.html', 'chunks/added-9.js'].map((path) => ({ path }));
    expect(writeOrder(entries, ['manifest.json', 'background.js', 'popup.html', 'chunks/old-1.js']).map((entry) => entry.path)).toEqual([
      'chunks/new-2.js',
      'chunks/added-9.js',
      'background.js',
      'popup.html',
      'manifest.json',
    ]);
  });
});

describe('parseFileList', () => {
  it('reads the list a nightly build carries', () => {
    expect(parseFileList('{"files":["manifest.json","background.js"]}')).toEqual(['manifest.json', 'background.js']);
  });

  it('refuses a list that is not one', () => {
    expect(parseFileList('nope')).toBeNull();
    expect(parseFileList('{"files":["background.js"]}')).toBeNull();
    expect(parseFileList('{"files":["manifest.json",3]}')).toBeNull();
  });
});
