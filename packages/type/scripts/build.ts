/**
 * Builds Geld Sans and Geld Dark Sans: UFO masters and designspaces into build/, then fonts into dist/
 * (variable, static TTF and OTF, WOFF2) and a proof page. Needs the Python tools in requirements.txt.
 *
 *   pnpm --filter @geld/type build            everything
 *   pnpm --filter @geld/type build --sources  only the UFOs and designspaces
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFontUnits, WEIGHTS } from '../src/grid';
import { alignKerning, computeKerning, type Kerning, kerningClasses, resolvedValue } from '../src/kerning';
import { CODE_GROUPS, CODE_LIGATURES, codePieceName } from '../src/code-ligatures';
import { buildMaster, type Family, type Master, type Style } from '../src/master';
import { proofPage } from '../src/proof';
import { decorationMetrics, designspace, postscriptName, sourceFileName, ufoFiles } from '../src/ufo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build');
const dist = join(root, 'dist');
const families: Family[] = ['sans', 'dark'];
const styles: Style[] = ['roman', 'italic'];
const python = process.env.PYTHON ?? 'python3';

function run(args: string[]): void {
  const result = spawnSync(python, args, { stdio: 'inherit', cwd: root });
  if (result.status !== 0) throw new Error(`${python} ${args.join(' ')} failed`);
}

/** Each style and weight's kerning, Geld Sans's, which Geld Dark Sans shares. */
const kernings = new Map<string, Kerning>();

function writeSources(): string[] {
  rmSync(build, { recursive: true, force: true });
  const spaces: string[] = [];
  for (const family of families) {
    for (const style of styles)
      for (const weight of WEIGHTS) {
        const ufo = join(build, sourceFileName(family, style, weight));
        // Geld Dark Sans takes Geld Sans's kerning, so switching families never reflows text.
        const key = `${style} ${weight}`;
        if (!kernings.has(key)) {
          const classes = kerningClasses(buildMaster('sans', style, 400));
          const aligned = alignKerning(WEIGHTS.map((w) => computeKerning(buildMaster('sans', style, w), classes)));
          WEIGHTS.forEach((w, i) => kernings.set(`${style} ${w}`, aligned[i]!));
        }
        for (const [path, text] of ufoFiles(buildMaster(family, style, weight), kernings.get(key))) {
          mkdirSync(dirname(join(ufo, path)), { recursive: true });
          writeFileSync(join(ufo, path), text);
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

/** What the source says each compiled font must contain, for scripts/verify.py. */
function manifest(): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const family of families) {
    const byStyle: Record<string, Record<string, unknown>> = {};
    for (const style of styles) {
      const byWeight: Record<string, unknown> = {};
      for (const weight of WEIGHTS) {
        const master = buildMaster(family, style, weight);
        const deco = decorationMetrics(weight);
        byWeight[weight] = {
          postscriptName: postscriptName(family, weight, style),
          advances: Object.fromEntries(master.glyphs.map((g) => [g.name, Math.round(toFontUnits(g.advance))])),
          cmap: Object.fromEntries(
            master.glyphs.flatMap((g) => (g.unicode === undefined ? [] : [[g.unicode.toString(16).toUpperCase().padStart(4, '0'), g.name]])),
          ),
          underlinePosition: Math.round(deco.underlinePosition),
          decorationThickness: Math.round(deco.thickness),
          strikeoutPosition: Math.round(deco.strikeoutPosition),
          codeLigatures: codeLigatureCases(master),
          kerning: Object.fromEntries(KERNING_SAMPLES.map(([x, y]) => [`${x} ${y}`, Math.round(toFontUnits(resolvedValue(kernings.get(`${style} ${weight}`)!, x, y)))])),
        };
      }
      byStyle[style] = byWeight;
    }
    out[family === 'sans' ? 'GeldSans' : 'GeldDarkSans'] = byStyle;
  }
  return out;
}

function compile(spaces: string[]): void {
  rmSync(dist, { recursive: true, force: true });
  for (const space of spaces) {
    run(['-m', 'fontmake', '-m', space, '-o', 'variable', '--output-dir', join(dist, 'variable')]);
    run(['-m', 'fontmake', '-m', space, '-i', '-o', 'ttf', '--output-dir', join(dist, 'ttf')]);
    run(['-m', 'fontmake', '-m', space, '-i', '-o', 'otf', '--output-dir', join(dist, 'otf')]);
  }
  const variable = readdirSync(join(dist, 'variable')).map((f) => join(dist, 'variable', f));
  run([join(root, 'scripts', 'finish.py'), ...variable]);
  mkdirSync(join(dist, 'web'), { recursive: true });
  for (const folder of ['variable', 'ttf'])
    for (const file of readdirSync(join(dist, folder)).filter((f) => f.endsWith('.ttf')))
      run(['-m', 'fontTools.ttLib.woff2', 'compress', '-o', join(dist, 'web', file.replace(/\.ttf$/, '.woff2')), join(dist, folder, file)]);
  writeFileSync(join(dist, 'proof.html'), proofPage());
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(manifest(), null, 2)}\n`);
  run([join(root, 'scripts', 'verify.py')]);
}

const spaces = writeSources();
if (!process.argv.includes('--sources')) compile(spaces);
