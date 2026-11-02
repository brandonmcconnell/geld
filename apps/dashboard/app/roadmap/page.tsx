import {Suspense} from 'react';
import {connection} from 'next/server';
import {notFound} from 'next/navigation';
import {featureFlags} from '@/lib/features';
import {FeatureStub} from '@/components/feature-stub';
async function Roadmap(){await connection();if(!(await featureFlags()).roadmaps)notFound();return <FeatureStub title="Roadmap"/>;}
export default function RoadmapPage(){return <Suspense><Roadmap/></Suspense>;}
