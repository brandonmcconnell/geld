import { defineConfig } from 'wxt';
import type { ThemeIcon } from 'wxt';
import { ACTION_ICON_SIZES, actionIconPath } from './src/lib/action-icon';

/** `theme_icons` is Firefox-only and missing from the generic manifest typings. */
interface ThemeAwareAction {
  theme_icons?: ThemeIcon[];
}

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  manifest: ({ browser, manifestVersion }) => ({
    name: 'Geld',
    short_name: 'Geld',
    description:
      'Hide test files from GitHub diffs. Review what matters; the tests wait in a tidy section at the bottom.',
    homepage_url: 'https://github.com/brandonmcconnell/geld',
    // Black mark on a white tile; large sizes keep store listings and Safari's
    // app icon sharp on high-density displays.
    icons: Object.fromEntries([16, 32, 48, 96, 128, 256, 512].map((size) => [String(size), `icon/${size}.png`])),
    permissions: [
      'storage',
      // Chrome/Edge: an offscreen document watches prefers-color-scheme so the
      // toolbar icon can switch between the black and white marks.
      ...(manifestVersion === 3 && (browser === 'chrome' || browser === 'edge') ? ['offscreen'] : []),
    ],
    // patch-diff.githubusercontent.com serves the raw `.diff` that github.com
    // redirects to; it is fetched from the background script only.
    host_permissions: ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*'],
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
