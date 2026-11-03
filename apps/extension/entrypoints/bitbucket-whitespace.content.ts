import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBitbucketNativeWhitespace } from '../src/bitbucket/whitespace-main';
export default defineContentScript({ matches: ['https://bitbucket.org/*'], world: 'MAIN', runAt: 'document_start', main: () => { startBitbucketNativeWhitespace(document, window); } });
