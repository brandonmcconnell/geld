import { Suspense } from 'react';
import { connection } from 'next/server';
import { ReviewDefaults } from '@/components/review-defaults';
export default function Page({params}:{readonly params:Promise<{id:string}>}){return <Suspense fallback={<div className="page">Loading defaults...</div>}><View params={params}/></Suspense>;}
async function View({params}:{readonly params:Promise<{id:string}>}){await connection();return <ReviewDefaults teamId={(await params).id}/>;}
