'use client';
import { Button } from '@geld/ui';
export default function ErrorPage({ reset }: { readonly reset: () => void }) { return <div className="page"><h1>This view could not be loaded</h1><p>Your provider connection may need another try.</p><Button onClick={reset}>Try again</Button></div>; }
