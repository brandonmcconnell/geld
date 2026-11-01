'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { TRACKER_LABELS } from '@geld/core';
import type { PullRef } from '@geld/domain';
import { useDashboard } from './app-shell';
const schema=z.object({links:z.array(z.object({provider:z.enum(['linear','jira','github_issues','github_projects','gitlab','bitbucket','youtrack','asana','monday']),id:z.string(),url:z.url(),status:z.string().nullable()}))});
export function TrackerLinks({reference}:{readonly reference:PullRef}) {
  const {activeTeam}=useDashboard();
  const [result,setResult]=useState<{query:string;links:z.infer<typeof schema>['links']}|null>(null);
  const query=new URLSearchParams({...reference,number:String(reference.number),...(activeTeam?{team:activeTeam}:{})}).toString();
  const links=result?.query===query?result.links:[];
  useEffect(()=>{
    const abort=new AbortController();
    fetch(`/api/tracker/links?${query}`,{signal:abort.signal}).then(async response=>{
      const parsed=schema.safeParse(await response.json());
      if(abort.signal.aborted)return;
      setResult({query,links:response.ok&&parsed.success?parsed.data.links:[]});
    }).catch(()=>{if(!abort.signal.aborted)setResult({query,links:[]});});
    return()=>abort.abort();
  },[query]);
  if(!links.length)return null;
  return <div className="review-banner tracker-links"><span>Links</span>{links.map(link=><a href={link.url} key={`${link.provider}:${link.url}`} target="_blank" rel="noreferrer" className="tracker-link"><Image src={`/tracker-icons/${link.provider}.svg`} alt="" width={16} height={16} unoptimized/><span>{TRACKER_LABELS[link.provider]}</span> {link.id}{link.status&&<small> · {link.status}</small>}</a>)}</div>;
}
