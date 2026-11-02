'use client';
import {useEffect,useState} from 'react';
import {z} from 'zod';
import {Button} from '@geld/ui';
import {queueSchema} from '@/lib/contracts';
import type {QueueData} from '@/lib/contracts';
import {useDashboard} from './app-shell';
const choicesSchema=z.object({choices:z.array(z.object({provider:z.string(),host:z.string(),id:z.string(),visible:z.boolean()}))});
const repoKey=(repo:QueueData['repositories'][number])=>`${repo.ref.provider}:${repo.ref.host}:${repo.id}`;
export function RepositorySelection(){const{session}=useDashboard();return <SelectionWorkspace key={session.user?.id??'signed-out'}/>;}
function SelectionWorkspace(){
  const{session,refresh}=useDashboard();const actorId=session.user?.id;
  const[rows,setRows]=useState<QueueData['repositories']>([]);const[hidden,setHidden]=useState<readonly string[]>([]);const[confirmedHidden,setConfirmedHidden]=useState<readonly string[]>([]);
  const[page,setPage]=useState(1);const[more,setMore]=useState(false);const[busy,setBusy]=useState(false);const[message,setMessage]=useState('');
  useEffect(()=>{
    if(!actorId)return;const abort=new AbortController();
    void Promise.all([fetch(`/api/queue?includeHidden=true&cursor=${page}`,{signal:abort.signal}).then(r=>r.json()),fetch('/api/repositories/selection',{signal:abort.signal}).then(r=>r.json())]).then(([raw,choices])=>{
      if(abort.signal.aborted)return;const queue=queueSchema.safeParse(raw);const selected=choicesSchema.safeParse(choices);
      if(queue.success){setRows(previous=>[...new Map([...(page>1?previous:[]),...queue.data.repositories].map(repo=>[repoKey(repo),repo])).values()]);setMore(queue.data.sources?.some(source=>source.more)??false);}
      if(selected.success&&page===1){const initial=selected.data.choices.filter(row=>!row.visible).map(row=>`${row.provider}:${row.host}:${row.id}`);setHidden(initial);setConfirmedHidden(initial);}
    }).catch(()=>{if(!abort.signal.aborted)setMessage('Repositories could not be loaded.');});return()=>abort.abort();
  },[page,actorId]);
  async function save(){
    setBusy(true);let saved=0;
    const changed=rows.filter(repo=>hidden.includes(repoKey(repo))!==confirmedHidden.includes(repoKey(repo)));
    try{
      for(let offset=0;offset<changed.length;offset+=1000){
        const batch=changed.slice(offset,offset+1000);const response=await fetch('/api/repositories/selection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choices:batch.map(repo=>({provider:repo.ref.provider,host:repo.ref.host,id:repo.id,visible:!hidden.includes(repoKey(repo))}))})});
        if(!response.ok||!z.object({saved:z.literal(true)}).safeParse(await response.json()).success)throw new Error('Selection not confirmed');
        saved+=batch.length;setConfirmedHidden(previous=>{const next=new Set(previous);for(const repo of batch){const key=repoKey(repo);if(hidden.includes(key))next.add(key);else next.delete(key);}return [...next];});
      }
      setMessage('Repository selection saved.');
    }catch{setMessage(saved?'Some choices were saved. Retry to save the remaining changes.':'Repository selection could not be saved.');}
    finally{setBusy(false);if(saved)refresh();}
  }
  return <section className="settings-card"><h2>Visible repositories</h2><p>Every available repository starts selected. Choose which appear in your personal queue and sidebar. Team access stays under each team’s settings.</p>{rows.length>0&&<label className="settings-row"><span>Select all loaded repositories</span><input type="checkbox" disabled={busy} checked={rows.every(repo=>!hidden.includes(repoKey(repo)))} onChange={event=>setHidden(previous=>event.target.checked?previous.filter(key=>!rows.some(repo=>repoKey(repo)===key)):[...new Set([...previous,...rows.map(repoKey)])])}/></label>}{rows.map(repo=><label className="settings-row" key={repoKey(repo)}><span>{repo.ref.owner}/{repo.ref.repo}<small> {repo.ref.host}</small></span><input type="checkbox" disabled={busy} checked={!hidden.includes(repoKey(repo))} onChange={event=>setHidden(previous=>event.target.checked?previous.filter(key=>key!==repoKey(repo)):[...previous,repoKey(repo)])}/></label>)}{more&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>setPage(page+1)}>Load more repositories</Button>}<Button variant="outline" disabled={busy||!session.configured||!rows.length} onClick={()=>{void save();}}>Save visible repositories</Button>{message&&<p role="status" className="status-message">{message}</p>}</section>;
}
