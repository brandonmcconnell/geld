import { defineContentScript } from 'wxt/utils/define-content-script';
import { bitbucketAdapter } from '../../src/bitbucket';
import { startProvider } from '../../src/providers/runtime';
import '../../src/providers/style.css';
import '../../src/bitbucket/theme.css';

export default defineContentScript({
  matches: ['https://bitbucket.org/*'],
  runAt: 'document_start',
  main: (ctx) => startProvider(ctx, bitbucketAdapter),
});
