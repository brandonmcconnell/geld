/**
 * Builds Geld Sans and Geld Dark Sans: UFO masters and designspaces into build/, then fonts into dist/
 * (variable, static TTF and OTF, WOFF2) and a proof page. Needs the Python tools in requirements.txt.
 *
 *   pnpm --filter @geld/type build            everything, as CI and a push need it
 *   pnpm --filter @geld/type build --quick    the variable fonts, proof and their checks only, for iterating
 *   pnpm --filter @geld/type build --sources  only the UFOs and designspaces
 *
 * Independent compiles run in parallel, one per core (GELD_TYPE_JOBS overrides), and each phase prints its time.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFontUnits, WEIGHTS } from '../src/grid';
import { alignKerning, computeKerning, type Kerning, kerningClasses, resolvedValue } from '../src/kerning';
import { ALTERNATES, alternateName } from '../src/alternates';
import { CODE_GROUPS, CODE_LIGATURES, codePieceName } from '../src/code-ligatures';
import { buildMaster, type Family, type Master, type Style } from '../src/master';
import { proofPage } from '../src/proof';
import { decorationMetrics, designspace, postscriptName, productionNames, sourceFileName, ufoFiles } from '../src/ufo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build');
const dist = join(root, 'dist');
const families: Family[] = ['sans', 'dark'];
const styles: Style[] = ['roman', 'italic'];
const python = process.env.PYTHON ?? 'python3';
const quick = process.argv.includes('--quick');
const jobs = Number(process.env.GELD_TYPE_JOBS) || availableParallelism();

/**
 * Runs one Python command. Run in parallel, its output is kept to show only if it fails, since the logs would interleave;
 * `shown` passes it straight through.
 */
function run(args: string[], shown = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: root, stdio: shown ? 'inherit' : 'pipe' });
    const output: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${python} ${args.join(' ')} failed:\n${Buffer.concat(output).toString()}`));
    });
  });
}

/** Runs the commands at most `jobs` at a time, in the order given (longest first pays off), starting none after a failure. */
async function runAll(commands: string[][]): Promise<void> {
  const queue = [...commands];
  let failed = false;
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && !failed; next = queue.shift()) {
      try {
        await run(next);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, commands.length) }, worker));
}

/** Splits a list into `count` lists of nearly equal length. */
function chunks<T>(list: T[], count: number): T[][] {
  return Array.from({ length: Math.min(count, list.length) }, (_, i) => list.filter((_, j) => j % count === i));
}

async function phase<T>(name: string, work: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  console.log(`${name}: ${((performance.now() - start) / 1000).toFixed(1)} s`);
  return result;
}

/** Each style and weight's kerning, Geld Sans's, which Geld Dark Sans shares. */
const kernings = new Map<string, Kerning>();

/** What the source says each compiled font must contain, for scripts/verify.py, taken while each master is built. */
const expected: Record<string, Record<string, Record<string, unknown>>> = {};

function writeSources(): string[] {
  rmSync(build, { recursive: true, force: true });
  const spaces: string[] = [];
  for (const family of families) {
    for (const style of styles) {
      // The Geld Sans masters the kerning is measured on are the ones written, rather than built a second time.
      const measured = new Map<number, Master>();
      for (const weight of WEIGHTS) {
        const ufo = join(build, sourceFileName(family, style, weight));
        // Geld Dark Sans takes Geld Sans's kerning, so switching families never reflows text.
        const key = `${style} ${weight}`;
        if (!kernings.has(key)) {
          for (const w of WEIGHTS) measured.set(w, buildMaster('sans', style, w));
          const classes = kerningClasses(measured.get(400)!);
          const aligned = alignKerning(WEIGHTS.map((w) => computeKerning(measured.get(w)!, classes)));
          WEIGHTS.forEach((w, i) => kernings.set(`${style} ${w}`, aligned[i]!));
        }
        const master = measured.get(weight) ?? buildMaster(family, style, weight);
        measured.delete(weight);
        for (const [path, text] of ufoFiles(master, kernings.get(key))) {
          mkdirSync(dirname(join(ufo, path)), { recursive: true });
          writeFileSync(join(ufo, path), text);
        }
        const name = family === 'sans' ? 'GeldSans' : 'GeldDarkSans';
        ((expected[name] ??= {})[style] ??= {})[weight] = manifestEntry(master, kernings.get(key)!);
      }
    }
    const file = join(build, `${family === 'sans' ? 'GeldSans' : 'GeldDarkSans'}.designspace`);
    writeFileSync(file, designspace(family));
    spaces.push(file);
  }
  return spaces;
}

/** Pairs whose kerning verify.py checks in every compiled font, kerned and unkerned alike. */
const KERNING_SAMPLES: [string, string][] = [
  ['T', 'o'], ['T', 'a'], ['A', 'V'], ['L', 'T'], ['P', 'period'], ['Y', 'o'], ['quoteleft', 'A'], ['T', 'eacute'], ['Tcaron', 'a'],
  ['Ge-cy', 'o-cy'], ['Tau', 'alpha'], ['H', 'H'], ['n', 'n'], ['o', 'o'], ['one.tf', 'one.tf'], ['f', 'period'], ['V', 'a'], ['T', 'space'], ['space', 'Y'], ['f', 'idieresis'],
];

/** Each code ligature as verify.py shapes it: its text, the feature that turns it on, and the glyphs it must become. */
function codeLigatureCases(master: Master): { text: string; feature: string; pieces: string[]; narrower: boolean }[] {
  const byChar = new Map(master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[String.fromCodePoint(g.unicode), g.name] as const])));
  return CODE_LIGATURES.map((lig) => {
    const group = CODE_GROUPS[lig.group];
    return {
      text: lig.text,
      feature: group.dlig ? 'dlig' : group.feature!,
      pieces: [...lig.text].map((ch, i) => codePieceName(byChar.get(ch)!, lig, i)),
      narrower: lig.group !== 'prose',
    };
  });
}

/** Each alternate in this master: its character, the glyph it becomes, and the features that turn it on (its set, its cv, salt when first). */
function alternateCases(master: Master): { char: string; glyph: string; features: string[] }[] {
  const names = new Set(master.glyphs.map((g) => g.name));
  const first = new Set<string>();
  return ALTERNATES.flatMap((alt) => {
    const glyph = alternateName(alt);
    const base = master.glyphs.find((g) => g.name === alt.glyph);
    if (!names.has(glyph) || base?.unicode === undefined) return [];
    const features = [...(alt.set ? [alt.set] : []), alt.cv, ...(first.has(alt.glyph) ? [] : ['salt'])];
    first.add(alt.glyph);
    return [{ char: String.fromCodePoint(base.unicode), glyph, features }];
  });
}

/** One master's entry in the manifest verify.py checks the compiled fonts against. */
function manifestEntry(master: Master, kerning: Kerning): Record<string, unknown> {
  const deco = decorationMetrics(master.weight);
  return {
    postscriptName: postscriptName(master.family, master.weight, master.style),
    advances: Object.fromEntries(master.glyphs.map((g) => [g.name, Math.round(toFontUnits(g.advance))])),
    cmap: Object.fromEntries(
      master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[g.unicode.toString(16).toUpperCase().padStart(4, '0'), g.name]])),
    ),
    underlinePosition: Math.round(deco.underlinePosition),
    decorationThickness: Math.round(deco.thickness),
    strikeoutPosition: Math.round(deco.strikeoutPosition),
    codeLigatures: codeLigatureCases(master),
    alternates: alternateCases(master),
    productionNames: productionNames(master),
    kerning: Object.fromEntries(KERNING_SAMPLES.map(([x, y]) => [`${x} ${y}`, Math.round(toFontUnits(resolvedValue(kerning, x, y)))])),
  };
}

async function compile(spaces: string[]): Promise<void> {
  rmSync(dist, { recursive: true, force: true });
  // The variable fonts are fontc's (seconds, where fontmake took a quarter of an hour each); the statics are still
  // fontmake's, the OTFs first since they take longest (overlaps removed and the CFF subroutinized for nine weights).
  const statics = (output: string) => spaces.map((space) => ['-m', 'fontmake', '-m', space, '-i', '-o', output, '--output-dir', join(dist, output)]);
  const variable = spaces.map((space) => [join(root, 'scripts', 'variable.py'), space, join(dist, 'variable')]);
  await phase('compile', () => runAll(quick ? variable : [...statics('otf'), ...statics('ttf'), ...variable]));
  const fonts = (folder: string) => readdirSync(join(dist, folder)).filter((f) => f.endsWith('.ttf')).map((f) => join(dist, folder, f));
  await phase('finish', () => run([join(root, 'scripts', 'finish.py'), ...fonts('variable')]));
  if (!quick) {
    const statics = [...fonts('ttf'), ...readdirSync(join(dist, 'otf')).map((f) => join(dist, 'otf', f))];
    await phase('finish statics', () => runAll(chunks(statics, jobs).map((files) => [join(root, 'scripts', 'finish.py'), '--static', ...files])));
    const hinted = fonts('ttf');
    mkdirSync(join(dist, 'web'), { recursive: true });
    // D18: the static TTFs are hinted with ttfautohint, but the web fonts are made from them unhinted, so hinting writes
    // beside each TTF and replaces it only once the web fonts exist.
    await phase('woff2 and hinting', () =>
      runAll([
        ...chunks([...fonts('variable'), ...hinted], jobs).map((files) => [join(root, 'scripts', 'woff2.py'), join(dist, 'web'), ...files]),
        ...hinted.map((path) => ['-m', 'ttfautohint', '--no-info', '--stem-width-mode=nss', path, `${path}.hinted`]),
      ]),
    );
    for (const path of hinted) renameSync(`${path}.hinted`, path);
    await phase('hinted flags', () => run([join(root, 'scripts', 'finish.py'), '--hinted', ...hinted]));
  }
  writeFileSync(join(dist, 'proof.html'), proofPage());
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(expected, null, 2)}\n`);
  await phase('verify', () => run([join(root, 'scripts', 'verify.py'), `--jobs=${jobs}`, ...(quick ? ['--quick'] : [])], true));
}

const spaces = await phase('sources', writeSources);
if (!process.argv.includes('--sources')) await compile(spaces);
