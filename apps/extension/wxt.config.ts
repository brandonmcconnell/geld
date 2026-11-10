import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig } from 'wxt';
import type { ThemeIcon } from 'wxt';
import { ACTION_ICON_SIZES, actionIconPath } from './src/lib/action-icon';
import { version as baseVersion } from './package.json';

/**
 * Stores need a strictly increasing manifest version but do not require a
 * commit for it: Chrome, Edge, Firefox and Safari all accept four numeric
 * parts, so CI appends its run number (`GELD_BUILD_NUMBER`) to the version in
 * package.json — 0.1.1 becomes 0.1.1.68 — and every build is publishable.
 * package.json only changes when the marketing version does.
 */
const buildNumber = process.env.GELD_BUILD_NUMBER?.trim() ?? '';
const manifestVersion = /^\d+$/.test(buildNumber) ? `${baseVersion}.${buildNumber}` : baseVersion;

/**
 * `GELD_CHANNEL=nightly` (scripts/nightly.mjs) builds the nightly builds CI
 * attaches to every release beside the store zips (src/nightly/). Loaded
 * unpacked, Chrome's and Edge's check GitHub for a newer release and write it
 * into their own folder. It is a production build like the store
 * ones: a WXT `--mode` would also set NODE_ENV and `import.meta.env.DEV`,
 * which change how WXT, Geld's error capture and dependencies run. The store
 * builds compile all of the updater away and leave out the nightly page.
 */
const nightly = process.env.GELD_CHANNEL === 'nightly';
/**
 * Every browser gets a nightly build, but only Chromium's (Chrome, Edge) can replace their own files and so
 * update themselves: Firefox installs only builds Mozilla signed, through its own updater, and Safari's ship
 * inside an app. Theirs are the store code under the nightly name, updated by hand.
 */
const selfUpdating = (browser: string): boolean => nightly && (browser === 'chrome' || browser === 'edge');
/** Mirrors NIGHTLY_NAME in @geld/core/nightly.ts, which refuses any other build as an update. */
const NIGHTLY_NAME = 'Geld Nightly';
/** Mirrors FILE_LIST in @geld/core/nightly.ts: the files a nightly build copies before it is replaced. */
const NIGHTLY_FILE_LIST = 'nightly-files.json';
/** Mirrors CONTENT_SCRIPTS_FILE in src/nightly/conflicts.ts: the manifest's content scripts, which a nightly build registers itself. */
const NIGHTLY_CONTENT_SCRIPTS = 'nightly-content-scripts.json';
let nightlyContentScripts: unknown = null;

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** `theme_icons` is Firefox-only and missing from the generic manifest typings. */
interface ThemeAwareAction {
  theme_icons?: ThemeIcon[];
}

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  // `pnpm dev` does not launch a throwaway browser: load `.output/chrome-mv3-dev`
  // once via chrome://extensions → "Load unpacked" (about:debugging in Firefox)
  // in your own profile — signed in, with your other extensions — and WXT
  // rebuilds and reloads it on every change. To get the launcher back for
  // yourself, create the git-ignored `web-ext.config.ts` with `disabled: false`.
  webExt: { disabled: true },
  ...(nightly ? { outDirTemplate: '{{browser}}-mv{{manifestVersion}}-nightly' } : {}),
  vite: ({ browser }) => ({ define: { __GELD_NIGHTLY__: JSON.stringify(selfUpdating(browser)) } }),
  manifest: ({ browser, manifestVersion: mv }) => {
    const updater = selfUpdating(browser);
    const channel = nightly ? 'nightly' : 'build';
    return {
      name: nightly ? NIGHTLY_NAME : 'Geld',
      short_name: nightly ? NIGHTLY_NAME : 'Geld',
      version: manifestVersion,
      // Chrome shows this instead of the raw number; other browsers ignore it.
      ...(browser === 'chrome' || browser === 'edge' ? { version_name: buildNumber === '' ? (nightly ? `${baseVersion} (nightly)` : baseVersion) : `${baseVersion} (${channel} ${buildNumber})` } : {}),
      // Chrome shows it as the listing's summary and caps it at 132 characters.
      description: 'Code review is broken. Geld fixes it. One digest of each pull request, the noise set aside, and review controls on every tab.',
      homepage_url: 'https://github.com/brandonmcconnell/geld',
      // Black mark on a white tile. Deliberately no 48/96: chrome://extensions
      // requests the smallest icon >= 48 and shows it in a 48 CSS px box, so an
      // exact 48 gets upscaled on Retina while 128 is downsampled and stays sharp.
      // 256/512 keep store listings and Safari's app icon crisp.
      icons: Object.fromEntries([16, 32, 128, 256, 512].map((size) => [String(size), `icon/${size}.png`])),
      permissions: [
        'storage',
        // Daily check for a newer signed pattern catalog (no install warning).
        'alarms',
        // MV3: registers the content script on GitHub Enterprise hosts the user adds.
        ...(mv === 3 ? ['scripting'] : []),
        // Nightly: writes an update into the unpacked folder when that folder sits in Downloads,
        // and sees whether Geld Stable is on in the profile, in which case it stays out of GitHub's pages.
        ...(updater ? ['downloads', 'downloads.ui', 'management'] : []),
      ],
      // patch-diff.githubusercontent.com serves the raw `.diff` that github.com
      // redirects to; it is fetched from the background script only.
      // api.github.com serves the optional GitHub sign-in (gist sync) and the
      // signed pattern catalog (catalog/patterns.json via the contents API).
      web_accessible_resources:[{resources:['tracker-icons/*.svg'],matches:['https://*/*']}],
      host_permissions: [
        'https://github.com/*',
        'https://patch-diff.githubusercontent.com/*',
        'https://api.github.com/*',
        // Nightly: github.com redirects a release asset's download to these hosts.
        ...(updater ? ['https://release-assets.githubusercontent.com/*', 'https://objects.githubusercontent.com/*'] : []),
      ],
      // GitHub Enterprise Server and AI gateways: the user grants specific hosts from the options page.
      // Loopback http is for a model served on this computer (mirrors LOOPBACK_HOSTS in src/lib/ai-gateway.ts).
      ...(mv === 3
        ? { optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'] }
        : { optional_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'] }),
      commands: {
        'toggle-hidden': {
          suggested_key: { default: 'Alt+Shift+T' },
          description: 'Show or hide the files Geld hides on the current page',
        },
      },
      ...(browser === 'firefox'
        ? {
            browser_specific_settings: {
              gecko: {
                // Its own id, so a nightly build installs beside Geld Stable rather than over it.
                id: nightly ? 'geld-nightly@brandonmcconnell.com' : 'geld@brandonmcconnell.com',
                strict_min_version: '128.0',
                // Dashboard sign-in and tracker status are optional and need separate host permission.
                data_collection_permissions: { required: ['none'], optional: ['authenticationInfo','personallyIdentifyingInfo','websiteContent'] },
              },
            },
          }
        : {}),
    };
  },
  hooks: {
    'build:done': (wxt) => {
      if (!selfUpdating(wxt.config.browser)) return;
      writeFileSync(join(wxt.config.outDir, NIGHTLY_CONTENT_SCRIPTS), `${JSON.stringify(nightlyContentScripts, null, 2)}\n`);
      const files = [...new Set([...filesIn(wxt.config.outDir), NIGHTLY_FILE_LIST])].sort();
      writeFileSync(join(wxt.config.outDir, NIGHTLY_FILE_LIST), `${JSON.stringify({ files }, null, 2)}\n`);
    },
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (selfUpdating(wxt.config.browser)) return;
      for (const name of ['nightly', 'conflict']) {
        const at = entrypoints.findIndex((entrypoint) => entrypoint.name === name);
        if (at !== -1) entrypoints.splice(at, 1);
      }
    },
    'build:manifestGenerated': (wxt, manifest) => {
      // Chrome and Edge cannot tell a light toolbar from a dark one, so they get the framed mark, which reads on both.
      if ((wxt.config.browser === 'chrome' || wxt.config.browser === 'edge') && manifest.action !== undefined) {
        manifest.action.default_icon = Object.fromEntries(ACTION_ICON_SIZES.map((size) => [String(size), actionIconPath('framed', size)]));
      }
      if (selfUpdating(wxt.config.browser)) {
        // src/nightly/pause.ts registers these only while no Geld Stable is on: declared, they would start beside it.
        nightlyContentScripts = manifest.content_scripts ?? [];
        delete manifest.content_scripts;
      }
      if (wxt.config.browser !== 'firefox') return;
      // Firefox picks the icon by theme text colour: `dark` is the dark icon
      // (light themes), `light` is the light icon (dark themes).
      const action: ThemeAwareAction | undefined = manifest.browser_action ?? manifest.action;
      if (action === undefined) return;
      action.theme_icons = ACTION_ICON_SIZES.map((size) => ({
        dark: actionIconPath('black', size),
        light: actionIconPath('white', size),
        size,
      }));
    },
  },
  zip: {
    name: 'geld',
    artifactTemplate: `{{name}}-{{version}}-{{browser}}${nightly ? '-nightly' : ''}.zip`,
    // AMO's review wants the sources of the store build only, and publish.yml uploads the one `*-sources.zip`.
    ...(nightly ? { zipSources: false } : {}),
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
  },
});
