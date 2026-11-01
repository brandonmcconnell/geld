// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/acme/platform/pull/12"}
import {describe,expect,it,vi} from 'vitest';
import {DEFAULT_SETTINGS} from '@geld/core';
vi.mock('wxt/browser',()=>({browser:{runtime:{getURL:(path:string)=>`chrome-extension://test${path}`,sendMessage:async()=>({links:[]})}}}));
vi.mock('../lib/dashboard-session',()=>({dashboardTrackerItem:{getValue:async()=>null,watch:()=>()=>undefined}}));
import {applyTrackerLinks,removeTrackerLinks} from './tracker-links';
describe('the no-account tracker links row',()=>{
 it('recognizes description links, excludes code and remains idempotent across DOM passes',()=>{document.body.innerHTML='<header class="gh-header"><h1 class="js-issue-title">Fix #7</h1><div class="gh-header-meta">Open</div></header><div class="js-issue-body"><div class="markdown-body"><p>ENG-12</p><pre>ENG-99</pre><code>ENG-88</code></div></div>';const configs=[{categories:{},groups:{},categoryPatterns:{},customCategories:[],reviewBots:[],issueTracker:{provider:'linear',keys:['ENG'],workspace:'acme'}}] satisfies Parameters<typeof applyTrackerLinks>[1];applyTrackerLinks(DEFAULT_SETTINGS,configs);const row=document.getElementById('geld-links-row');expect(row?.querySelectorAll('a')).toHaveLength(2);expect(row?.textContent).toContain('ENG-12');expect(row?.textContent).not.toContain('ENG-99');expect(row?.textContent).not.toContain('ENG-88');applyTrackerLinks(DEFAULT_SETTINGS,configs);expect(document.querySelectorAll('#geld-links-row')).toHaveLength(1);removeTrackerLinks();expect(document.getElementById('geld-links-row')).toBeNull();});
});
