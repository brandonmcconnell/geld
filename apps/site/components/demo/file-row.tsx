import { formatCount } from '@geld/core';
import { cn } from 'cn';
import { FileCodeIcon } from 'lucide-react';

import type { ClassifiedFile } from '@/components/demo/sample-pr';
import { splitPath } from '@/components/demo/sample-pr';

export function FileRow({ file, dim = false }: { readonly file: ClassifiedFile; readonly dim?: boolean }) {
  const { directory, basename } = splitPath(file.path);
  return (
    <li className={cn('flex items-center gap-2 px-4 py-1.5 font-mono text-xs not-last:border-b', dim && 'text-muted-foreground')}>
      <FileCodeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{directory}</span>
        <span className={cn(dim ? 'text-muted-foreground' : 'text-foreground')}>{basename}</span>
      </span>
      <span className="shrink-0 tabular-nums">
        <span className="text-addition">+{formatCount(file.additions)}</span> <span className="text-deletion">&minus;{formatCount(file.deletions)}</span>
      </span>
    </li>
  );
}
