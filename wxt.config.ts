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
    host_permissions: ['https://github.com/*'],
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
