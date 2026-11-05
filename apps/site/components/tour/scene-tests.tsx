'use client';

import { cn } from 'cn';
import { ChevronRightIcon, FileCodeIcon } from 'lucide-react';
import { useState } from 'react';

import { CARD_HEAD } from '@/components/tour/bits';
import { TOUR_FILES } from '@/components/tour/data';
import { Ping } from '@/components/tour/ping';
import { PrWindow } from '@/components/tour/pr-window';

type Kind = 'add' | 'del' | 'ctx';

interface Line {
  readonly n: number;
  readonly kind: Kind;
  readonly text: string;
}

interface Test {
  readonly title: string;
  readonly start: number;
  readonly lines: readonly Line[];
}

const add = (n: number, text: string): Line => ({ n, kind: 'add', text });
const del = (n: number, text: string): Line => ({ n, kind: 'del', text });
const ctx = (n: number, text: string): Line => ({ n, kind: 'ctx', text });

const TESTS: readonly Test[] = [
  {
    title: 'beforeEach',
    start: 6,
    lines: [ctx(6, '  beforeEach(() => {'), del(7, '    onClick = vi.fn();'), add(7, '    onChange = vi.fn();'), ctx(8, '  });')],
  },
  {
    title: 'renders its label',
    start: 10,
    lines: [ctx(10, "  it('renders its label', () => {"), add(11, "    render(<Button label=\"Save\" />);"), add(12, "    expect(screen.getByRole('button')).toHaveTextContent('Save');"), ctx(13, '  });')],
  },
  {
    title: 'calls onChange when controlled',
    start: 15,
    lines: [
      add(15, "  it('calls onChange when controlled', async () => {"),
      add(16, '    render(<Button pressed={false} onChange={onChange} />);'),
      add(17, "    await user.click(screen.getByRole('button'));"),
      add(18, '    expect(onChange).toHaveBeenCalledWith(true);'),
      add(19, "    expect(screen.getByRole('button')).not.toBePressed();"),
      add(20, '  });'),
    ],
  },
  {
    title: 'keeps its own state when uncontrolled',
    start: 22,
    lines: [
      ctx(22, "  it('keeps its own state when uncontrolled', async () => {"),
      del(23, '    render(<Button />);'),
      add(23, '    render(<Button defaultPressed />);'),
      add(24, "    await user.click(screen.getByRole('button'));"),
      ctx(25, "    expect(screen.getByRole('button')).not.toBePressed();"),
      ctx(26, '  });'),
    ],
  },
];

function countsOf(lines: readonly Line[]): { readonly additions: number; readonly deletions: number } {
  return { additions: lines.filter((line) => line.kind === 'add').length, deletions: lines.filter((line) => line.kind === 'del').length };
}

const OPENED = 'calls onChange when controlled';

export function TestsScene() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([OPENED]));
  // One test open at a time keeps the file inside the window.
  const toggle = (title: string): void => setOpen((previous) => (previous.has(title) ? new Set() : new Set([title])));
  // The whole file's count, as every other scene shows it; the tests below are only the hunks that changed most.
  const total = TOUR_FILES.find((file) => file.path === 'src/Button.test.tsx') ?? countsOf(TESTS.flatMap((test) => test.lines));

  return (
    <PrWindow tab="files" filesCount={6}>
      {/* Not clipped, so the open test's ping spreads past the card's sides; the header rounds its own corners instead. */}
      <div className="m-3 rounded-lg border">
        <div className={cn(CARD_HEAD, 'rounded-t-[7px] bg-muted/60 font-mono text-xs')}>
          <FileCodeIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">src/</span>Button.test.tsx
          </span>
          <span className="tabular-nums">
            <span className="text-addition">+{total.additions}</span> <span className="text-deletion">&minus;{total.deletions}</span>
          </span>
        </div>
        <div className="font-mono text-xs">
          <CodeRow line={ctx(4, "describe('Button', () => {")} />
          {TESTS.map((test) => {
            const isOpen = open.has(test.title);
            const counts = countsOf(test.lines);
            return (
              <div key={test.title} className="border-t first:border-t-0">
                <Ping on={test.title === OPENED} className="flex">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(test.title)}
                    className={cn('flex w-full items-center gap-3 py-1.5 pr-3 text-left font-sans outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted', isOpen && 'border-b')}
                  >
                    <span className="w-10 shrink-0 pr-2 text-right font-mono text-[0.6875rem] text-muted-foreground tabular-nums">{test.start}</span>
                    <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem]', test.title === 'beforeEach' ? 'font-mono text-xs' : 'font-medium')}>{test.title}</span>
                    <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums">
                      <span className="text-addition">+{counts.additions}</span> <span className="text-deletion">&minus;{counts.deletions}</span>
                    </span>
                    <ChevronRightIcon aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  </button>
                </Ping>
                <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                  <div className="overflow-hidden" inert={!isOpen}>
                    {test.lines.map((line, index) => (
                      <CodeRow key={index} line={line} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          <CodeRow line={ctx(28, '});')} />
        </div>
      </div>
    </PrWindow>
  );
}

function CodeRow({ line }: { readonly line: Line }) {
  return (
    <div className={cn('flex whitespace-pre', line.kind === 'add' && 'bg-addition-muted/70', line.kind === 'del' && 'bg-deletion-muted/70')}>
      <span className="w-10 shrink-0 pr-2 text-right text-[0.6875rem] leading-5 text-muted-foreground tabular-nums select-none">{line.n}</span>
      <span className="w-4 shrink-0 text-center leading-5 text-muted-foreground select-none">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
      <span className="min-w-0 overflow-hidden leading-5 text-ellipsis whitespace-pre">{line.text}</span>
    </div>
  );
}
