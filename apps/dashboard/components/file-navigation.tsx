'use client';
import { useState } from 'react';
import { ChevronDown, FileCode2, ListTree, Search } from './icons';
import type { PlanFile } from '@geld/review/plan';
import { diffId } from './diff-view';
type CategorizedFile = PlanFile & { readonly category?: string | null | undefined };
export function fileGroups(files: readonly CategorizedFile[]) {
  const groups = new Map<string, CategorizedFile[]>();
  for (const file of files) {
    const label = file.hidden ? (file.category ?? 'Hidden changes') : 'Essential';
    const group = groups.get(label) ?? [];
    group.push(file);
    groups.set(label, group);
  }
  return [...groups].sort(([a], [b]) => (a === 'Essential' ? -1 : b === 'Essential' ? 1 : a.localeCompare(b)));
}
export function FileNavigation({ files }: { readonly files: readonly CategorizedFile[] }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [query, setQuery] = useState('');
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
        Files<span>{files.length}</span>
        <ChevronDown size={14} />
      </button>
      <nav id="changed-files" aria-label="Changed files">
        <p>
          Files <span>{files.length}</span>
        </p>
        <label className="step-search">
          <Search size={13} />
          <input
            name="fileSearch"
            aria-label="Find a file"
            placeholder="Find a file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {fileGroups(files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()))).map(
          ([label, group]) => (
            <details className="file-category" key={label} open>
              <summary>
                {label} · {group.length}
              </summary>
              {group.map((file) => (
                <a
                  key={file.path}
                  href={`#${encodeURIComponent(diffId(file.path))}`}
                  aria-current={selected === file.path ? 'location' : undefined}
                  onClick={() => {
                    setSelected(file.path);
                    setOpen(false);
                    const target = document.getElementById(diffId(file.path));
                    let parent = target?.parentElement;
                    while (parent) {
                      if (parent instanceof HTMLDetailsElement) parent.open = true;
                      parent = parent.parentElement;
                    }
                    requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' }));
                  }}
                >
                  <FileCode2 size={14} />
                  <span title={file.path}>{file.path}</span>
                  <small className="file-status" data-status={file.status}>
                    {file.status === 'added'
                      ? 'A'
                      : file.status === 'deleted'
                        ? 'D'
                        : file.status === 'renamed'
                          ? 'R'
                          : 'M'}
                  </small>
                </a>
              ))}
            </details>
          ),
        )}
      </nav>
    </aside>
  );
}
