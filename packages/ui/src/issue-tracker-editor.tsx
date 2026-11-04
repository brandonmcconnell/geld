'use client';
import { useId,useState } from 'react';
import type { IssueTrackerConfig } from '@geld/core/trackers';
import { ISSUE_TRACKERS,TRACKER_LABELS,parseIssueTracker } from '@geld/core/trackers';
import type { IssueTrackerField } from '@geld/core/settings-schema';
import { Button } from './button';
interface TrackerDraft {readonly base:string;readonly provider:string;readonly keys:string;readonly baseUrl:string;readonly workspace:string}
export function IssueTrackerEditor({field,value,disabled=false,onSave}:{readonly field:IssueTrackerField;readonly value:IssueTrackerConfig|null;readonly disabled?:boolean;readonly onSave:(config:IssueTrackerConfig|null)=>Promise<{readonly ok:true}|{readonly ok:false;readonly message:string}>}) {
  const id=useId();
  const base=JSON.stringify(value);
  const [draft,setDraft]=useState<TrackerDraft|null>(null);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const current=draft?.base===base?draft:{base,provider:value?.provider??'',keys:value?.keys.join('\n')??'',baseUrl:value?.baseUrl??'',workspace:value?.workspace??''};
  const needsOrigin=['jira','youtrack','monday'].includes(current.provider);
  async function save() {
    const keys=current.keys.split(/[\s,]+/).filter(Boolean);
    const config=current.provider?parseIssueTracker({provider:current.provider,keys,...(needsOrigin&&current.baseUrl?{baseUrl:current.baseUrl}:{}),...(current.provider==='linear'&&current.workspace?{workspace:current.workspace}:{})}):null;
    if(current.provider&&(!config||!keys.length||needsOrigin&&!config.baseUrl||current.provider==='linear'&&!config.workspace)){setMessage('Choose allowed scopes and the required workspace or HTTPS origin.');return;}
    setSaving(true);setMessage('');
    try {const result=await onSave(config);setMessage(result.ok?'Personal tracker saved.':result.message);if(result.ok)setDraft(null);}
    catch {setMessage('The personal tracker could not be saved. Try again.');}
    finally {setSaving(false);}
  }
  return <form aria-labelledby={`${id}-title`} className="grid gap-3 py-4" onSubmit={event=>{event.preventDefault();void save();}}><h3 id={`${id}-title`} className="font-medium">{field.label}</h3><p className="text-sm text-muted-foreground">{field.description}</p><label className="grid gap-1" htmlFor={`${id}-provider`}>{field.providerLabel}<select id={`${id}-provider`} className="field rounded-md border bg-background p-2" value={current.provider} disabled={disabled||saving} onChange={event=>setDraft({...current,provider:event.target.value})}><option value="">{field.noneLabel}</option>{ISSUE_TRACKERS.map(provider=><option key={provider} value={provider}>{TRACKER_LABELS[provider]}</option>)}</select></label>{current.provider&&<><label className="grid gap-1" htmlFor={`${id}-keys`}>{field.keysLabel}<textarea id={`${id}-keys`} className="field rounded-md border bg-background p-2" rows={3} value={current.keys} placeholder={field.keysPlaceholder} disabled={disabled||saving} onChange={event=>setDraft({...current,keys:event.target.value})}/></label><p className="text-sm text-muted-foreground">{field.keysDescription}</p>{needsOrigin&&<label className="grid gap-1" htmlFor={`${id}-origin`}>{field.baseUrlLabel}<input id={`${id}-origin`} className="field rounded-md border bg-background p-2" type="url" value={current.baseUrl} placeholder="https://tracker.example.com" disabled={disabled||saving} onChange={event=>setDraft({...current,baseUrl:event.target.value})}/></label>}{current.provider==='linear'&&<label className="grid gap-1" htmlFor={`${id}-workspace`}>{field.workspaceLabel}<input id={`${id}-workspace`} className="field rounded-md border bg-background p-2" value={current.workspace} disabled={disabled||saving} onChange={event=>setDraft({...current,workspace:event.target.value})}/></label>}</>}<div><Button type="submit" disabled={disabled||saving}>{saving?'Saving...':field.saveLabel}</Button></div><p role="status" className="text-sm text-muted-foreground">{message}</p></form>;
}
