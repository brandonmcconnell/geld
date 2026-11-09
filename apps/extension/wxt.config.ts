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
 * `--mode nightly` builds the self-updating Chromium build CI attaches to
 * every release beside the store zips (src/nightly/). Loaded unpacked, it
 * checks GitHub for a newer release and writes it into its own folder. The
 * store builds compile all of that away and leave out the nightly page.
 */
const NIGHTLY_MODE = 'nightly';
/** Mirrors NIGHTLY_NAME in src/nightly/build-check.ts, which refuses any other build as an update. */
const NIGHTLY_NAME = 'Geld Nightly';

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
  manifest: ({ browser, manifestVersion: mv, mode }) => {
    const nightly = mode === NIGHTLY_MODE;
    const channel = nightly ? 'nightly' : 'build';
    return {
      name: nightly ? NIGHTLY_NAME : 'Geld',
      short_name: nightly ? NIGHTLY_NAME : 'Geld',
      version: manifestVersion,
      // Chrome shows this instead of the raw number; other browsers ignore it.
      ...(browser === 'chrome' || browser === 'edge' ? { version_name: buildNumber === '' ? (nightly ? `${baseVersion} (nightly)` : baseVersion) : `${baseVersion} (${channel} ${buildNumber})` } : {}),
      description:
        'Hide test files from GitHub diffs. Review what matters; the tests wait in a tidy section at the bottom.',
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
        // Chrome/Edge: an offscreen document watches prefers-color-scheme so the
        // toolbar icon can switch between the black and white marks.
        ...(mv === 3 && (browser === 'chrome' || browser === 'edge') ? ['offscreen'] : []),
        // MV3: registers the content script on GitHub Enterprise hosts the user adds.
        ...(mv === 3 ? ['scripting'] : []),
        // Nightly: writes an update into the unpacked folder when that folder sits in Downloads.
        ...(nightly ? ['downloads', 'downloads.ui'] : []),
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
        ...(nightly ? ['https://release-assets.githubusercontent.com/*', 'https://objects.githubusercontent.com/*'] : []),
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
                id: 'geld@brandonmcconnell.com',
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
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode === NIGHTLY_MODE) return;
      const at = entrypoints.findIndex((entrypoint) => entrypoint.name === 'nightly');
      if (at !== -1) entrypoints.splice(at, 1);
    },
    'build:manifestGenerated': (wxt, manifest) => {
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
    artifactTemplate: '{{name}}-{{version}}-{{browser}}{{modeSuffix}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
  },
});
