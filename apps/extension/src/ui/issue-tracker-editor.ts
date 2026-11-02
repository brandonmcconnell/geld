import { ISSUE_TRACKERS,TRACKER_LABELS,parseIssueTracker } from '@geld/core';
import type { IssueTrackerConfig,IssueTrackerField } from '@geld/core';
export function issueTrackerEditor(field:IssueTrackerField,value:IssueTrackerConfig|null,onSave:(config:IssueTrackerConfig|null)=>Promise<IssueTrackerConfig|null>):{readonly element:HTMLFieldSetElement;readonly setValue:(value:IssueTrackerConfig|null)=>void} {
  const root=document.createElement('fieldset');root.className='options__tracker';
  const legend=document.createElement('legend');legend.className='geld-label';legend.textContent=field.label;
  const description=document.createElement('p');description.className='geld-help';description.textContent=field.description;
  const provider=document.createElement('select');provider.className='geld-input';provider.setAttribute('aria-label',field.providerLabel);
  const none=document.createElement('option');none.value='';none.textContent=field.noneLabel;provider.append(none);
  for(const kind of ISSUE_TRACKERS){const option=document.createElement('option');option.value=kind;option.textContent=TRACKER_LABELS[kind];provider.append(option);}
  const keys=document.createElement('textarea');keys.className='geld-textarea options__textarea';keys.rows=3;keys.placeholder=field.keysPlaceholder;keys.setAttribute('aria-label',field.keysLabel);
  const origin=document.createElement('input');origin.type='url';origin.className='geld-input';origin.placeholder='https://tracker.example.com';origin.setAttribute('aria-label',field.baseUrlLabel);
  const workspace=document.createElement('input');workspace.className='geld-input';workspace.setAttribute('aria-label',field.workspaceLabel);
  function label(copy:string,input:HTMLElement){const row=document.createElement('label');row.className='options__field';const title=document.createElement('span');title.className='geld-label';title.textContent=copy;row.append(title,input);return row;}
  const controls=document.createElement('div');controls.className='options__tracker-fields';
  const scopesHelp=document.createElement('p');scopesHelp.className='geld-help';scopesHelp.textContent=field.keysDescription;
  const originRow=label(field.baseUrlLabel,origin);const workspaceRow=label(field.workspaceLabel,workspace);
  controls.append(label(field.keysLabel,keys),scopesHelp,originRow,workspaceRow);
  const save=document.createElement('button');save.type='button';save.className='geld-button geld-button--primary';save.textContent=field.saveLabel;
  const status=document.createElement('p');status.className='geld-status';status.setAttribute('role','status');
  let dirty=false;
  const visible=()=>{controls.hidden=!provider.value;originRow.hidden=!['jira','youtrack','monday'].includes(provider.value);workspaceRow.hidden=provider.value!=='linear';};
  const fill=(config:IssueTrackerConfig|null)=>{provider.value=config?.provider??'';keys.value=config?.keys.join('\n')??'';origin.value=config?.baseUrl??'';workspace.value=config?.workspace??'';visible();};
  fill(value);
  for(const input of [provider,keys,origin,workspace])input.addEventListener('input',()=>{dirty=true;status.textContent='Unsaved changes';visible();});
  save.addEventListener('click',async()=>{
    const scopes=keys.value.split(/[\s,]+/).filter(Boolean);
    const needsOrigin=['jira','youtrack','monday'].includes(provider.value);
    const config=provider.value?parseIssueTracker({provider:provider.value,keys:scopes,...(needsOrigin&&origin.value?{baseUrl:origin.value}:{}),...(provider.value==='linear'&&workspace.value?{workspace:workspace.value}:{})}):null;
    if(provider.value&&(!config||!scopes.length||needsOrigin&&!config.baseUrl||provider.value==='linear'&&!config.workspace)){status.textContent='Choose allowed scopes and the required workspace or HTTPS origin.';return;}
    for(const input of [provider,keys,origin,workspace,save])input.disabled=true;
    try{const stored=await onSave(config);dirty=false;fill(stored);status.textContent='Personal tracker saved.';}
    catch{status.textContent='The personal tracker could not be saved. Try again.';}
    finally{for(const input of [provider,keys,origin,workspace,save])input.disabled=false;}
  });
  root.append(legend,description,label(field.providerLabel,provider),controls,save,status);
  return {element:root,setValue:config=>{if(!dirty)fill(config);}};
}
