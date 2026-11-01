import { defineContentScript } from 'wxt/utils/define-content-script';
import { gitlabAdapter } from '../../src/gitlab';
import { startProvider } from '../../src/providers/runtime';
import '../../src/providers/style.css';
import '../../src/gitlab/theme.css';
import '../../src/gitlab/comment-render.css';

export default defineContentScript({
  matches: ['https://gitlab.com/*'],
  runAt: 'document_start',
  main: (ctx) => startProvider(ctx, gitlabAdapter),
});
