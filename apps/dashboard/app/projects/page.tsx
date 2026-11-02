import {Suspense} from 'react';
import {connection} from 'next/server';
import {notFound} from 'next/navigation';
import {featureFlags} from '@/lib/features';
import {FeatureStub} from '@/components/feature-stub';
async function Projects(){await connection();if(!(await featureFlags()).projects)notFound();return <FeatureStub title="Projects"/>;}
export default function ProjectsPage(){return <Suspense><Projects/></Suspense>;}
