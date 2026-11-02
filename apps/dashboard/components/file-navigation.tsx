'use client';
import { useState } from 'react';
import { ChevronDown, FileCode2, ListTree } from 'lucide-react';
import type { PlanFile } from '@geld/review/plan';
import { diffId } from './diff-view';

export function FileNavigation({ files }: { readonly files: readonly PlanFile[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  return (
    <aside className="file-navigation" data-open={open}>
      <button
        type="button"
        className="file-navigation-toggle"
        aria-expanded={open}
        aria-controls="changed-files"
        onClick={() => setOpen(!open)}
      >
        <ListTree size={16} />
        Changed files<span>{files.length}</span>
        <ChevronDown size={14} />
      </button>
      <nav id="changed-files" aria-label="Changed files">
        <p>
          CHANGED FILES <span>{files.length}</span>
        </p>
        {files.map((file) => (
          <a
            key={file.path}
            href={`#${encodeURIComponent(diffId(file.path))}`}
            aria-current={selected === file.path ? 'location' : undefined}
            onClick={() => {
              setSelected(file.path);
              setOpen(false);
            }}
          >
            <FileCode2 size={15} />
            <span title={file.path}>{file.path}</span>
            <small className="file-status">
              {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M'}
            </small>
          </a>
        ))}
      </nav>
    </aside>
  );
}
