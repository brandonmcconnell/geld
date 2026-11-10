import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBitbucketNativeWhitespace } from '../src/bitbucket/whitespace-main';
import { startBitbucketNativeColorMode } from '../src/bitbucket/color-mode-main';
export default defineContentScript({ registration: 'runtime', matches: ['https://bitbucket.org/*'], world: 'MAIN', runAt: 'document_start', main: () => { startBitbucketNativeColorMode(document, window);startBitbucketNativeWhitespace(document, window); } });
