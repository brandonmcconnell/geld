'use client';

import { cn } from 'cn';
import { ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/tour/bits';
import { PrWindow } from '@/components/tour/pr-window';

interface Outline {
  readonly title: string;
  readonly level: 2 | 3;
  readonly body?: React.ReactNode;
  readonly children?: readonly Outline[];
}

const DESCRIPTION: readonly Outline[] = [
  {
    title: 'Summary',
    level: 2,
    body: (
      <p>
        Button can now be controlled. Pass <code>pressed</code> and <code>onChange</code> and it renders whatever you give it. Without them it keeps its
        own state, as before.
      </p>
    ),
  },
  {
    title: 'Changes',
    level: 2,
    children: [
      {
        title: 'API',
        level: 3,
        body: (
          <ul>
            <li>
              <code>pressed</code> and <code>onChange</code> make the button controlled
            </li>
            <li>
              <code>defaultPressed</code> sets the first state when it is not
            </li>
          </ul>
        ),
      },
      { title: 'Internals', level: 3, body: <p>The toggle state moved into a <code>useToggle</code> hook shared with Switch.</p> },
    ],
  },
  {
    title: 'Testing',
    level: 2,
    body: (
      <ul>
        <li>Unit tests for both modes</li>
        <li>A Cypress run on the docs page</li>
      </ul>
    ),
  },
  { title: 'Screenshots', level: 2, body: <p className="text-muted-foreground">button-states.png · button-disabled.png</p> },
];

export function OutlineScene() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(['API', 'Internals', 'Testing', 'Screenshots']));
  const toggle = (title: string): void =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  return (
    <PrWindow tab="conversation">
      <div className="m-3 overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Avatar who="octocat" size={18} />
          <span>
            <span className="font-semibold text-foreground">octocat</span> commented 2 days ago
          </span>
        </div>
        <div className="px-3 py-2 text-[0.8125rem] leading-5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.75rem] [&_li]:ml-4 [&_li]:list-disc [&_p]:my-0.5 [&_ul]:my-0.5">
          {DESCRIPTION.map((section) => (
            <Section key={section.title} section={section} closed={closed} onToggle={toggle} />
          ))}
        </div>
      </div>
    </PrWindow>
  );
}

function Section({ section, closed, onToggle }: { readonly section: Outline; readonly closed: ReadonlySet<string>; readonly onToggle: (title: string) => void }) {
  const open = !closed.has(section.title);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(section.title)}
        className={cn(
          'flex w-full items-center gap-1 rounded-md py-0.5 text-left font-semibold outline-none hover:bg-muted/60 focus-visible:bg-muted',
          section.level === 2 ? 'text-[0.9375rem]' : 'text-[0.8125rem]',
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
          <ChevronRightIcon aria-hidden="true" className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
        </span>
        {section.title}
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="overflow-hidden" inert={!open}>
          <div className="mb-1 ml-2.5 border-l pl-3.5">
            {section.body}
            {section.children?.map((child) => (
              <Section key={child.title} section={child} closed={closed} onToggle={onToggle} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
