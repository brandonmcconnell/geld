// @vitest-environment happy-dom
import { readBitbucketPendingReview } from './pending-review';
import { describeBitbucketPage } from './page';
import { readBitbucketActions } from './actions';
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined, defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }) } }));
const H='a'.repeat(40), URL='https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const current={current:()=>true};
// Source-only fixtures from page.da841cca.js:LhpXT/7YvK9/gNOVQ, not an authenticated browser capture.
function fixture(badge:string|null='2'){
 window.location.href=URL;
 document.head.innerHTML='<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":true,"isKbdShortcutsEnabled":true}\'>';
 document.body.innerHTML=`<div data-testid="pr-header"><a href="/atlassian/bitbucket-upload-file/src">repository</a><div data-qa="pr-branches-and-state-styles">OPEN</div><span>#27 • Created</span><div id="native-actions"><button type="button" id="discard">Discard Review</button><button type="button" id="finish"><span>Finish Review</span>${badge===null?'':`<span>${badge}</span>`}</button></div></div><section data-qa="conversations-global-style"><input data-testid="chrome-collapsed" value="Existing unsent draft"></section><div role="dialog"><button type="submit" id="submit">Submit</button><button id="confirm-discard">Discard</button></div>`;
 const page=describeBitbucketPage(new globalThis.URL(URL))!;
 const subject={provider:'bitbucket' as const,origin:'https://bitbucket.org',repository:'atlassian/bitbucket-upload-file',id:'27',headSha:H};
 const button=document.querySelector<HTMLButtonElement>('#finish')!,header=document.querySelector<HTMLElement>('[data-testid="pr-header"]')!,meta=document.head.querySelector('meta')!,draft=document.querySelector<HTMLInputElement>('input')!;
 const click=vi.fn();button.addEventListener('click',click);const submit=vi.fn();document.getElementById('submit')!.addEventListener('click',submit);document.getElementById('discard')!.addEventListener('click',submit);document.getElementById('confirm-discard')!.addEventListener('click',submit);
 const read=()=>readBitbucketPendingReview(document,page,subject);return{page,subject,button,header,meta,draft,click,submit,read};
}
afterEach(()=>{document.body.replaceChildren();document.head.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([null,'0','2','999999'])('opens only the original Finish Review control with optional integer badge %s, preserving native drafts',async(badge)=>{
 const f=fixture(badge),html=f.header.innerHTML;f.draft.setSelectionRange(2,7);const request=vi.fn();vi.stubGlobal('fetch',request);
 const action=f.read();expect(action?.kind).toBe('open-pending-review');expect(action?.available).toBe(true);expect(await action?.activate(current)).toBe(true);
 expect(f.click).toHaveBeenCalledOnce();expect(f.submit).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();expect(f.header.innerHTML).toBe(html);expect(document.activeElement).toBe(f.button);expect(f.draft.value).toBe('Existing unsent draft');expect([f.draft.selectionStart,f.draft.selectionEnd]).toEqual([2,7]);vi.unstubAllGlobals();
});
it('requires caller current context and never treats relay as a submission',async()=>{const f=fixture();const action=f.read();expect(await action?.activate()).toBe(false);expect(await action?.activate({current:()=>false})).toBe(false);expect(f.click).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();});
it('has a stable opaque scope for repeated same-head reads and pending badge updates',()=>{const f=fixture();const first=f.read()!.scopeKey;expect(f.read()?.scopeKey).toBe(first);f.button.lastElementChild!.textContent='3';expect(f.read()?.scopeKey).toBe(first);expect(first).not.toContain(H);expect(first).not.toContain('Authenticated');});
it.each(['prefix','overflow','two-badges','duplicate-label','hidden-label','nested-link','accessible-name','unknown-word']as const)('rejects unknown native label/badge structure %s',async(change)=>{
 const f=fixture();if(change==='prefix')f.button.firstElementChild!.textContent='Other Finish Review';if(change==='overflow')f.button.lastElementChild!.textContent='99+';
 if(change==='two-badges')f.button.insertAdjacentHTML('beforeend','<span>3</span>');if(change==='duplicate-label')f.button.insertAdjacentHTML('beforeend','<span>Finish Review</span>');
 if(change==='hidden-label')f.button.firstElementChild!.setAttribute('hidden','');if(change==='nested-link')f.button.insertAdjacentHTML('beforeend','<a href="#">2</a>');
 if(change==='accessible-name')f.button.setAttribute('aria-label','Submit review');if(change==='unknown-word')f.button.lastElementChild!.textContent='2 comments';
 expect(f.read()).toBeNull();expect(f.click).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
});
it('does not use an invisible label or treat a hidden unrelated fragment as a pending tally',()=>{const f=fixture();f.button.firstElementChild!.setAttribute('style','display:none');expect(f.read()).toBeNull();f.button.firstElementChild!.removeAttribute('style');f.button.lastElementChild!.setAttribute('aria-hidden','true');f.button.lastElementChild!.textContent='not a visible badge';expect(f.read()?.available).toBe(true);});
it('requires one eligible visible original; source does not guarantee pending sticky copies have tabindex=-1',()=>{
 const f=fixture();const copy=f.button.cloneNode(true);f.button.after(copy);expect(f.read()).toBeNull();if(!(copy instanceof HTMLElement))throw Error('Missing copied source fixture');copy.style.display='none';expect(f.read()?.available).toBe(true);copy.style.display='';copy.tabIndex=-1;expect(f.read()?.available).toBe(true);
});
it('rejects ordinary make-actions simultaneously presented during a native mode transition',()=>{const f=fixture();f.button.insertAdjacentHTML('afterend','<button disabled aria-pressed="false" aria-label="Approve this pull request">Approve</button>');expect(f.read()).toBeNull();f.button.nextElementSibling!.setAttribute('hidden','');expect(f.read()?.available).toBe(true);});
it.each(['disabled','readonly','hidden','inert','aria-disabled','aria-hidden','display','opacity','form','comment','owned']as const)('retires a source control under %s without invoking anything',async(change)=>{
 const f=fixture();const old=f.read();if(['disabled','readonly','hidden','inert'].includes(change))f.button.setAttribute(change,'');else if(change==='aria-disabled'||change==='aria-hidden')f.button.setAttribute(change,'true');else if(change==='display')f.button.style.display='none';else if(change==='opacity')f.button.style.opacity='0';else{const wrapper=document.createElement(change==='form'?'form':'div');if(change==='comment')wrapper.setAttribute('data-testid','comment-content');if(change==='owned')wrapper.setAttribute('data-geld-ui','');f.button.before(wrapper);wrapper.append(f.button);}
 expect(f.read()).toBeNull();expect(await old?.activate(current)).toBe(false);expect(f.click).not.toHaveBeenCalled();
});
it.each(['false','missing','malformed','body-forgery','duplicate']as const)('omits anonymous or unknown bootstrap %s',async(change)=>{
 const f=fixture();if(change==='false')f.meta.setAttribute('data-current-user','{"isAuthenticated":false}');if(change==='malformed')f.meta.setAttribute('data-current-user','{broken');if(change==='missing')f.meta.remove();if(change==='body-forgery'){document.body.append(f.meta);document.head.innerHTML='<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\'>';}
 if(change==='duplicate')document.head.append(f.meta.cloneNode(true));expect(f.read()).toBeNull();expect(f.click).not.toHaveBeenCalled();
});
it.each(['bootstrap-bytes','bootstrap-remount','button-remount','header-remount','button-parent','header-parent','route','subject-head','subject-repository']as const)('rejects old action after %s and never adopts a new owner',async(change)=>{
 const f=fixture();const old=f.read()!;
 if(change==='bootstrap-bytes')f.meta.setAttribute('data-current-user','{"isAuthenticated":true,"isKbdShortcutsEnabled":false}');
 if(change==='bootstrap-remount')f.meta.replaceWith(f.meta.cloneNode(true));if(change==='button-remount')f.button.replaceWith(f.button.cloneNode(true));if(change==='header-remount')f.header.replaceWith(f.header.cloneNode(true));
 if(change==='button-parent'){const wrapper=document.createElement('div');f.button.before(wrapper);wrapper.append(f.button);}if(change==='header-parent'){const wrapper=document.createElement('div');f.header.before(wrapper);wrapper.append(f.header);}
 if(change==='route')window.location.href=URL.replace('/27','/28');if(change==='subject-head')f.subject.headSha='b'.repeat(40);if(change==='subject-repository')f.subject.repository='atlassian/other';
 const next=f.read();expect(next?.scopeKey).not.toBe(old.scopeKey);expect(await old.activate(current)).toBe(false);expect(f.click).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
});
it('refuses focus-time route/auth/head/caller drift before clicking the original opener',async()=>{
 for(const change of ['route','auth','head','caller']){const f=fixture();let valid=true;const old=f.read()!;f.button.addEventListener('focus',()=>{if(change==='route')window.location.href=URL.replace('/27','/28');if(change==='auth')f.meta.setAttribute('data-current-user','{"isAuthenticated":false}');if(change==='head')f.subject.headSha='c'.repeat(40);if(change==='caller')valid=false;},{once:true});expect(await old.activate({current:()=>valid})).toBe(false);expect(f.click).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();}
});
it('refuses a source opener that cannot receive focus or whose known full head is unavailable',async()=>{const f=fixture();const old=f.read();vi.spyOn(f.button,'focus').mockImplementation(()=>undefined);expect(await old?.activate(current)).toBe(false);expect(f.click).not.toHaveBeenCalled();f.subject.headSha=H.slice(0,7);expect(f.read()).toBeNull();});
it('does not reinterpret Finish Review as normal Approve/Request changes or select native Submit/Discard',()=>{const f=fixture();expect(readBitbucketActions(document).slice(0,2).every((action)=>!action.available)).toBe(true);f.button.remove();expect(f.read()).toBeNull();expect(f.submit).not.toHaveBeenCalled();});

it('wires the native opener to the existing full-head review snapshot without an additional acquisition',async()=>{
 const f=fixture();const review=await import('./review');const {bitbucketAdapter}=await import('./index');
 const fetchReview=vi.spyOn(review,'fetchBitbucketReview').mockResolvedValue({input:{subject:f.subject,threads:[],closed:false},comments:[],events:[],tasks:[],complete:false,unavailable:[],approvalsRequired:null,approvalsLeft:null,actions:[]});
 if(bitbucketAdapter.fetchReview===undefined)throw Error('Missing adapter review service');
 const snapshot=await bitbucketAdapter.fetchReview(f.page,new AbortController().signal,document);const opener=snapshot.actions.find((action)=>action.kind==='open-pending-review');expect(opener?.scopeKey).toBeDefined();expect(await opener?.activate(current)).toBe(true);expect(f.click).toHaveBeenCalledOnce();
 expect(snapshot.actions.find((action)=>action.kind==='open-pending-review')?.scopeKey).toBe(opener?.scopeKey);expect(fetchReview).toHaveBeenCalledOnce();f.meta.setAttribute('data-current-user','{"isAuthenticated":false}');expect(snapshot.actions.some((action)=>action.kind==='open-pending-review')).toBe(false);expect(f.submit).not.toHaveBeenCalled();
});

it('requires an exact full-head provider/repository/review source and a direct original HEAD bootstrap',()=>{
 const f=fixture();for(const subject of [{...f.subject,id:'28'},{...f.subject,origin:'https://other.example'},{...f.subject,provider:'gitlab' as const},{...f.subject,headSha:''}])expect(readBitbucketPendingReview(document,f.page,subject)).toBeNull();
 const wrapper=document.createElement('div');document.head.append(wrapper);wrapper.append(f.meta);expect(f.read()).toBeNull();
});
