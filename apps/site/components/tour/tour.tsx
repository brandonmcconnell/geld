'use client';

import { cn } from 'cn';
import { MousePointerClickIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { CountsScene } from '@/components/tour/scene-counts';
import { DigestScene } from '@/components/tour/scene-digest';
import { NoiseScene } from '@/components/tour/scene-noise';
import { OutlineScene } from '@/components/tour/scene-outline';
import { QuickReviewScene } from '@/components/tour/scene-quick-review';
import { RequestScene } from '@/components/tour/scene-request';
import { StatusScene } from '@/components/tour/scene-status';
import { TestsScene } from '@/components/tour/scene-tests';
import { WorkflowScene } from '@/components/tour/scene-workflow';

interface Step {
  readonly id: string;
  readonly chapter: string;
  readonly title: string;
  readonly body: string;
  readonly hint: string;
  readonly Scene: () => React.ReactNode;
}

const STEPS: readonly Step[] = [
  {
    id: 'noise',
    chapter: 'Read less',
    title: 'Set the noise aside',
    body: 'Tests, generated files, lockfiles and docs move behind one row at the bottom of the diff. Nothing is deleted, and one click brings them back in place.',
    hint: 'Switch categories on and off',
    Scene: NoiseScene,
  },
  {
    id: 'counts',
    chapter: 'Read less',
    title: 'Counts that add up',
    body: 'The header, the Files changed tab and every row of your pull request lists leave hidden files out. The breakdown says where each line went.',
    hint: "Flip the switch to see GitHub's numbers",
    Scene: CountsScene,
  },
  {
    id: 'tests',
    chapter: 'Read less',
    title: 'Tests read as titles',
    body: 'When you do open a test file, each test is one line: where it starts, its name and its own count. Expand the ones worth reading.',
    hint: 'Open a test',
    Scene: TestsScene,
  },
  {
    id: 'workflow',
    chapter: 'Read less',
    title: 'Shell that reads like shell',
    body: "To GitHub, a workflow's multiline run block is one long string. Geld colours the script inside as the shell that runs it, on both sides of the diff.",
    hint: 'Flip the switch to see it as GitHub does',
    Scene: WorkflowScene,
  },
  {
    id: 'outline',
    chapter: 'Know where it stands',
    title: 'Descriptions you can skim',
    body: 'A long description folds under its headings, so what comes after it is in reach instead of a few screens down.',
    hint: 'Click a heading',
    Scene: OutlineScene,
  },
  {
    id: 'digest',
    chapter: 'Know where it stands',
    title: 'A digest, not a timeline',
    body: "Under the description, one panel says how the pull request stands: reviews, every bot's verdict, CI and previews. Then each push is a round with its threads, open ones first, and a thread opens as a chat.",
    hint: 'Open a thread and resolve it',
    Scene: DigestScene,
  },
  {
    id: 'request',
    chapter: 'Know where it stands',
    title: 'Ask the bots again',
    body: 'Request a review lists every review bot with what its last run said, and ticks the ones worth asking again. Run posts their triggers for you.',
    hint: 'Run the ticked bots',
    Scene: RequestScene,
  },
  {
    id: 'quick-review',
    chapter: 'Act from anywhere',
    title: 'Review from any tab',
    body: 'Approve, request changes or comment from Checks, Commits or any other tab, pending comments included. Hold ⌘ (Ctrl off a Mac) to approve in one click.',
    hint: 'Switch tabs, then review',
    Scene: QuickReviewScene,
  },
  {
    id: 'status',
    chapter: 'Act from anywhere',
    title: 'Change status from the pill',
    body: 'The state label is a menu. Merge, convert to draft, mark ready, close or reopen without scrolling to the merge box. Hold ⌘ and it merges in one click.',
    hint: 'Open the pill',
    Scene: StatusScene,
  },
];

/**
 * The home page's feature tour. On wide screens the steps scroll past a
 * sticky window that shows the step crossing the middle of the viewport; on
 * narrow ones each step carries its own window. Every scene is live.
 */
export function Tour() {
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = steps.current.indexOf(entry.target instanceof HTMLLIElement ? entry.target : null);
          if (index !== -1) setActive(index);
        }
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    for (const step of steps.current) if (step) observer.observe(step);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:gap-20">
      <ol className="flex flex-col gap-16 lg:gap-0">
        {STEPS.map((step, index) => {
          const chapterStart = index === 0 || STEPS[index - 1]?.chapter !== step.chapter;
          const isActive = index === active;
          return (
            <li
              key={step.id}
              ref={(element) => {
                steps.current[index] = element;
              }}
              className="flex flex-col justify-center lg:min-h-[78vh]"
            >
              <div className={cn('transition-opacity duration-500 lg:max-w-sm', !isActive && 'lg:opacity-35')}>
                {chapterStart ? <p className="mb-5 font-mono text-[0.8125rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">{step.chapter}</p> : null}
                <p className="flex items-center gap-3 font-mono text-sm text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                  <span aria-hidden="true" className="relative h-px w-12 overflow-hidden bg-border">
                    <span className={cn('absolute inset-0 origin-left bg-foreground transition-transform duration-700 ease-out', isActive ? 'scale-x-100' : 'scale-x-0')} />
                  </span>
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">{step.title}</h3>
                <p className="mt-3 text-base leading-7 text-muted-foreground text-pretty">{step.body}</p>
                <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium">
                  <MousePointerClickIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  {step.hint}
                </p>
              </div>
              <div className="mt-6 lg:hidden">
                <Plate>
                  <step.Scene />
                </Plate>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-[max(4.5rem,calc(50vh-18.25rem))]">
          <Plate className="h-[40rem]">
            <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
              {STEPS.map((step, index) => {
                const isActive = index === active;
                return (
                  <div
                    key={step.id}
                    data-scene={step.id}
                    inert={!isActive}
                    aria-hidden={!isActive}
                    className={cn(
                      'col-start-1 row-start-1 min-h-0 min-w-0 transition-opacity duration-500 ease-in-out [&>*]:h-full',
                      isActive ? 'opacity-100' : 'pointer-events-none opacity-0',
                    )}
                  >
                    <step.Scene />
                  </div>
                );
              })}
            </div>
          </Plate>
        </div>
      </div>
    </div>
  );
}

/** The dotted stage a scene stands on. */
function Plate({ children, className }: { readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <div
      className={cn(
        'relative border bg-muted/40 p-3 sm:p-6',
        'bg-[radial-gradient(color-mix(in_oklch,var(--foreground)_14%,transparent)_1px,transparent_1px)] bg-size-[14px_14px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
