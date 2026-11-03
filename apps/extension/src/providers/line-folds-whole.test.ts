// @vitest-environment happy-dom
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderDiffLine, ProviderDiffView } from './types';
import type { ProviderWholeTestSession } from './whole-test-context';
import { applyProviderLineFolds, clearProviderLineFolds, ATTR_PROVIDER_LINE_HIDDEN } from './line-folds';
const source=["it('begins above the hunk', () => {",'  first();','  second();','});','export const next = 1;'];
function fixture() {
  window.location.href='https://gitlab.com/group/repo/-/merge_requests/1/diffs';
  const root=document.createElement('section'),table=document.createElement('table');root.append(table);document.body.append(root);
  const lines:ProviderDiffLine[]=[];
  const add=(numbers:readonly number[])=>{const body=document.createElement('tbody');table.append(body);for(const number of numbers){const row=document.createElement('tr'),cell=document.createElement('td');cell.textContent=source[number-1]!;row.append(cell);body.append(row);row.id=`native-R${number}`;lines.push({root:row,newLine:number,newText:source[number-1]!,oldLine:number,oldText:source[number-1]!,kind:'context'});}lines.sort((a,b)=>a.newLine!-b.newLine!);};
  add([4,5]);const entry={root,path:'spec/file.test.ts',anchor:null,additions:0,deletions:0,readLines:()=>lines,expand:()=>true,collapse:()=>true};
  const view:ProviderDiffView={kind:'gitlab-rapid',container:root,entries:[entry],tree:[],treeHost:null,filteredPaths:new Set(),virtualized:false};let ready=false,token=1;
  const whole:ProviderWholeTestSession={mount:vi.fn(),source:()=>ready?{lines:source,bytes:source.join('\n').length,token}:null,reveal:vi.fn(),cancelReveal:vi.fn(),retain:vi.fn()};
  const apply=()=>applyProviderLineFolds(view,[{path:entry.path,additions:0,deletions:0}],DEFAULT_SETTINGS,undefined,whole);
  const button=()=>root.querySelector<HTMLButtonElement>('[data-geld-provider-fold-row^="test:"] button');
  const setReady=(value=true)=>{ready=value;};return{root,table,entry,whole,lines,add,apply,button,setReady,bump:()=>token++};
}
// Unit protocol only: real installed acceptance supplies actual browser input separately.
function unitTrustedClick(button:HTMLButtonElement){const event=new MouseEvent('click',{bubbles:true,cancelable:true});Object.defineProperty(event,'isTrusted',{value:true});button.dispatchEvent(event);}
afterEach(()=>{clearProviderLineFolds();document.body.replaceChildren();window.location.hash='';vi.restoreAllMocks();});
it('finds an unchanged test whose declaration is absent without claiming its native body is mounted',()=>{
 const f=fixture();f.apply();expect(f.button()).toBeNull();f.setReady();f.apply();expect(f.button()?.textContent).toContain('begins above the hunk');expect(f.button()?.getAttribute('aria-label')).toContain('from line 1');expect(f.button()?.getAttribute('aria-label')).toContain('Only displayed lines are available');
 expect(f.lines.find((line)=>line.newLine===4)?.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN)).toBe(true);expect(f.lines.find((line)=>line.newLine===5)?.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN)).toBe(false);
 f.button()!.click();expect(f.button()?.getAttribute('aria-expanded')).toBe('true');expect(f.whole.reveal).not.toHaveBeenCalled();expect(f.root.querySelectorAll('tr:not([data-geld-ui])')).toHaveLength(2);
});
it('keeps the shown-scope disclosure until every required original line exists, then removes it',()=>{
 const f=fixture();f.setReady();f.apply();f.button()!.click();f.add([1,2]);f.apply();expect(f.button()?.getAttribute('aria-label')).toContain('Only displayed lines are available');
 f.add([3]);f.apply();expect(f.button()?.getAttribute('aria-label')).not.toContain('Only displayed lines are available');expect(f.button()?.getAttribute('aria-expanded')).toBe('true');expect(f.lines.every((line)=>!line.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN))).toBe(true);
});
it('falls back to displayed-only analysis when the validated whole-source session is revoked',()=>{
 const f=fixture();f.setReady();f.apply();expect(f.button()).not.toBeNull();f.setReady(false);f.apply();expect(f.button()).toBeNull();expect(f.lines.every((line)=>!line.root.hasAttribute(ATTR_PROVIDER_LINE_HIDDEN))).toBe(true);
});
it('preserves explicit closure at an unchanged native fragment as new source becomes available',()=>{
 const f=fixture();window.location.hash='#native-R4';f.apply();f.setReady();f.apply();expect(f.button()?.getAttribute('aria-expanded')).toBe('true');f.button()!.click();expect(f.button()?.getAttribute('aria-expanded')).toBe('false');f.bump();f.apply();expect(f.button()?.getAttribute('aria-expanded')).toBe('false');
 window.location.hash='#other';f.apply();window.location.hash='#native-R4';f.apply();expect(f.button()?.getAttribute('aria-expanded')).toBe('true');
});
it('passes trusted unfold intent only while its exact owned current control remains connected',()=>{
 const f=fixture();f.setReady();f.apply();const button=f.button()!;unitTrustedClick(button);expect(f.whole.reveal).toHaveBeenCalledTimes(1);unitTrustedClick(button);expect(f.whole.cancelReveal).toHaveBeenCalledOnce();
 const outside=document.createElement('div');document.body.append(outside);outside.append(button);unitTrustedClick(button);expect(f.whole.reveal).toHaveBeenCalledTimes(1);
});
it('restores the focused owned control across provider TBODY remount without stealing unrelated focus',()=>{
 const f=fixture();f.setReady();f.apply();const original=f.button()!;original.focus();unitTrustedClick(original);expect(document.activeElement).toBe(original);
 const oldBody=f.table.querySelector('tbody')!;oldBody.remove();f.lines.splice(0);f.add([1,2,3,4,5]);f.apply();expect(f.button()).not.toBe(original);expect(document.activeElement).toBe(f.button());
 const outside=document.createElement('button');document.body.append(outside);outside.focus();f.table.querySelector('tbody')!.remove();f.lines.splice(0);f.add([1,2,3,4,5]);f.apply();expect(document.activeElement).toBe(outside);
});
