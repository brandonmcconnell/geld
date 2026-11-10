import { Suspense } from 'react';
import { Connections } from '@/components/connections';
export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="page">Loading connections...</div>}>
      <Connections />
    </Suspense>
  );
}
