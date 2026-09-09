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

/** `theme_icons` is Firefox-only and missing from the generic manifest typings. */
interface ThemeAwareAction {
  theme_icons?: ThemeIcon[];
}

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  manifest: ({ browser, manifestVersion: mv }) => ({
    name: 'Geld',
    short_name: 'Geld',
    version: manifestVersion,
    // Chrome shows this instead of the raw number; other browsers ignore it.
    ...(browser === 'chrome' || browser === 'edge' ? { version_name: buildNumber === '' ? baseVersion : `${baseVersion} (build ${buildNumber})` } : {}),
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
    ],
    // patch-diff.githubusercontent.com serves the raw `.diff` that github.com
    // redirects to; it is fetched from the background script only.
    // api.github.com serves the optional GitHub sign-in (gist sync) and the
    // signed pattern catalog (catalog/patterns.json via the contents API).
    host_permissions: ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*', 'https://api.github.com/*'],
    // GitHub Enterprise Server: the user grants specific hosts from the options page.
    ...(mv === 3
      ? { optional_host_permissions: ['https://*/*'] }
      : { optional_permissions: ['https://*/*'] }),
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
              // Geld never sends data anywhere; everything runs locally.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  hooks: {
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
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
  },
});
