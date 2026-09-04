import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  manifest: ({ browser }) => ({
    name: 'Geld',
    short_name: 'Geld',
    description:
      'Hide test files from GitHub diffs. Review what matters; the tests wait in a tidy section at the bottom.',
    homepage_url: 'https://github.com/brandonmcconnell/geld',
    permissions: ['storage'],
    // patch-diff.githubusercontent.com serves the raw `.diff` that github.com
    // redirects to; it is fetched from the background script only.
    host_permissions: ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'geld@brandonmcconnell.com',
              strict_min_version: '128.0',
            },
          },
        }
      : {}),
  }),
  zip: {
    name: 'geld',
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
  },
});
