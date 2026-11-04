// @vitest-environment happy-dom
import { describe,expect,it,vi } from 'vitest';
import { fieldsFor } from '@geld/core';
import { issueTrackerEditor } from './issue-tracker-editor';
describe('personal tracker editor',()=>{
  it('validates scopes and origin, preserves dirty edits and saves normalized settings',async()=>{
    const field=fieldsFor('extension').find(value=>value.kind==='issue-tracker');
    if(!field)throw new Error('Missing shared tracker field');
    const save=vi.fn(async(value:Parameters<typeof issueTrackerEditor>[1])=>value);
    const editor=issueTrackerEditor(field,null,save);document.body.replaceChildren(editor.element);
    const provider=editor.element.querySelector('select');const keys=editor.element.querySelector('textarea');const origin=editor.element.querySelector('input[type=url]');const button=editor.element.querySelector('button');
    if(!(provider instanceof HTMLSelectElement)||!(keys instanceof HTMLTextAreaElement)||!(origin instanceof HTMLInputElement)||!button)throw new Error('Missing editor controls');
    provider.value='jira';provider.dispatchEvent(new Event('input'));keys.value='ENG';keys.dispatchEvent(new Event('input'));origin.value='http://jira.example.test';button.click();
    expect(save).not.toHaveBeenCalled();expect(editor.element.textContent).toContain('HTTPS origin');
    editor.setValue(null);expect(provider.value).toBe('jira');
    origin.value='https://jira.example.test/';button.click();
    await vi.waitFor(()=>expect(save).toHaveBeenCalledWith({provider:'jira',keys:['ENG'],baseUrl:'https://jira.example.test'}));
    await vi.waitFor(()=>expect(button.disabled).toBe(false));
    provider.value='';provider.dispatchEvent(new Event('input'));button.click();
    await vi.waitFor(()=>expect(save).toHaveBeenLastCalledWith(null));
  });
});
