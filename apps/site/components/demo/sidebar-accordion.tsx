'use client';

import { pluralize } from '@geld/core';
import { cn } from 'cn';
import { ChevronRightIcon, FileIcon, FlaskConicalIcon, FolderIcon, GitPullRequestIcon } from 'lucide-react';

import type { ClassifiedFile } from '@/components/demo/sample-pr';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface TreeNode {
  readonly name: string;
  readonly children: TreeNode[];
  readonly isFile: boolean;
}

function buildTree(files: readonly ClassifiedFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [], isFile: false };
  for (const file of files) {
    let node = root;
    const segments = file.path.split('/');
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      let child = node.children.find((candidate) => candidate.name === segment && candidate.isFile === isFile);
      if (child === undefined) {
        child = { name: segment, children: [], isFile };
        node.children.push(child);
      }
      node = child;
    });
  }
  return root;
}

/** Collapse single-child directories the way GitHub's tree does (`src/hooks`). */
function mergeSingleChildDirectories(node: TreeNode): TreeNode {
  if (node.isFile) return node;
  let current = node;
  while (current.children.length === 1 && current.children[0] !== undefined && !current.children[0].isFile && current.name !== '') {
    const only = current.children[0];
    current = { name: `${current.name}/${only.name}`, children: only.children, isFile: false };
  }
  return { ...current, children: current.children.map(mergeSingleChildDirectories) };
}

function Tree({ node, depth }: { readonly node: TreeNode; readonly depth: number }) {
  const directories = node.children.filter((child) => !child.isFile).sort((a, b) => a.name.localeCompare(b.name));
  const files = node.children.filter((child) => child.isFile).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className={cn(depth > 0 && 'border-l border-border/70')} style={{ marginLeft: depth > 0 ? 10 : 0 }}>
      {directories.map((directory) => (
        <li key={directory.name}>
          <div className="flex items-center gap-1.5 py-1 pl-1.5 text-muted-foreground">
            <ChevronRightIcon aria-hidden="true" className="size-3 rotate-90" />
            <FolderIcon aria-hidden="true" className="size-3.5" />
            <span className="truncate">{directory.name}</span>
          </div>
          <Tree node={directory} depth={depth + 1} />
        </li>
      ))}
      {files.map((file) => (
        <li key={file.name} className="flex items-center gap-1.5 py-1 pl-6">
          <FileIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The file-tree sidebar as Geld renders it: GitHub's own tree becomes a
 * "Changes" panel and each hidden category gets one of its own.
 */
export function SidebarAccordion({
  visible,
  hidden,
  hiddenTitle,
  hiddenNoun,
  hiddenNounPlural,
  className,
}: {
  readonly visible: readonly ClassifiedFile[];
  readonly hidden: readonly ClassifiedFile[];
  readonly hiddenTitle: string;
  readonly hiddenNoun: string;
  readonly hiddenNounPlural: string;
  readonly className?: string | undefined;
}) {
  const visibleTree = mergeSingleChildDirectories(buildTree(visible));
  const hiddenTree = mergeSingleChildDirectories(buildTree(hidden));
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card font-mono text-xs shadow-xs', className)}>
      <Accordion defaultValue={['changes']} className="gap-0">
        <AccordionItem value="changes">
          <AccordionTrigger className="px-3 font-sans">
            <span className="inline-flex items-center gap-2">
              <GitPullRequestIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              Changes
              <span className="rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border ring-inset">{visible.length}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3">
            <Tree node={visibleTree} depth={0} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="hidden">
          <AccordionTrigger className="px-3 font-sans">
            <span className="inline-flex items-center gap-2">
              <FlaskConicalIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              {hiddenTitle}
              <span className="rounded-full bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border ring-inset">{hidden.length}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3">
            <p className="mb-2 pl-1.5 font-sans text-muted-foreground">{pluralize(hidden.length, hiddenNoun, hiddenNounPlural)}. Browsing here never changes the diff.</p>
            <Tree node={hiddenTree} depth={0} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
