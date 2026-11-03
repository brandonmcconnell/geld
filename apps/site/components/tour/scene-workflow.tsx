'use client';

import { cn } from 'cn';
import { FileCodeIcon } from 'lucide-react';
import { useState } from 'react';

import { PrWindow } from '@/components/tour/pr-window';
import { Switch } from '@/components/ui/switch';

/** Token kinds, named for highlight.js's Bash scopes the extension paints (workflow-syntax.ts), plus GitHub's YAML key. */
type Token = 'plain' | 'key' | 'string' | 'keyword' | 'built_in' | 'variable' | 'comment';

/** GitHub's prettylights colours for each scope, as the extension's `::highlight(geld-shell-*)` rules map them. */
const COLOR: Record<Token, string> = {
  plain: '',
  key: 'text-[light-dark(#116329,#7ee787)]',
  string: 'text-[light-dark(#0a3069,#a5d6ff)]',
  keyword: 'text-[light-dark(#cf222e,#ff7b72)]',
  built_in: 'text-[light-dark(#8250df,#d2a8ff)]',
  variable: 'text-[light-dark(#953800,#ffa657)]',
  comment: 'text-[light-dark(#59636e,#9198a1)]',
};

type Segment = readonly [Token, string];

interface Line {
  readonly n: number;
  readonly kind: 'add' | 'del' | 'ctx';
  readonly indent: string;
  readonly segments: readonly Segment[];
  /** A line of a `run: |` block: one string to GitHub, a script to Geld. */
  readonly shell?: true;
}

const yaml = (n: number, indent: string, key: string, value = ''): Line => ({
  n,
  kind: 'ctx',
  indent,
  segments: value === '' ? [['key', key], ['plain', ':']] : [['key', key], ['plain', ': '], ['string', value]],
});

const shell = (n: number, kind: Line['kind'], indent: string, segments: readonly Segment[]): Line => ({ n, kind, indent, segments, shell: true });

const LINES: readonly Line[] = [
  yaml(8, '', 'jobs'),
  yaml(9, '  ', 'test'),
  yaml(10, '    ', 'runs-on', 'ubuntu-latest'),
  yaml(11, '    ', 'steps'),
  { n: 12, kind: 'ctx', indent: '      ', segments: [['plain', '- '], ['key', 'uses'], ['plain', ': '], ['string', 'actions/checkout@v4']] },
  { n: 13, kind: 'ctx', indent: '      ', segments: [['plain', '- '], ['key', 'name'], ['plain', ': '], ['string', 'Test']] },
  { n: 14, kind: 'ctx', indent: '        ', segments: [['key', 'run'], ['plain', ': '], ['keyword', '|']] },
  shell(15, 'del', '          ', [['plain', 'pnpm test']]),
  shell(15, 'add', '          ', [
    ['keyword', 'if'],
    ['plain', ' [[ '],
    ['string', '"'],
    ['variable', '$GITHUB_EVENT_NAME'],
    ['string', '"'],
    ['plain', ' == '],
    ['string', '"pull_request"'],
    ['plain', ' ]]; '],
    ['keyword', 'then'],
  ]),
  shell(16, 'add', '            ', [['plain', 'pnpm test --changed '], ['string', '"origin/'], ['variable', '${GITHUB_BASE_REF}'], ['string', '"']]),
  shell(17, 'add', '          ', [['keyword', 'else']]),
  shell(18, 'add', '            ', [['plain', 'pnpm test --coverage  '], ['comment', '# full run on main']]),
  shell(19, 'add', '          ', [['keyword', 'fi']]),
  shell(20, 'add', '          ', [
    ['built_in', 'echo'],
    ['plain', ' '],
    ['string', '"Tests took '],
    ['variable', '${SECONDS}'],
    ['string', 's"'],
    ['plain', ' >> '],
    ['string', '"'],
    ['variable', '$GITHUB_STEP_SUMMARY'],
    ['string', '"'],
  ]),
  { n: 21, kind: 'ctx', indent: '      ', segments: [['plain', '- '], ['key', 'name'], ['plain', ': '], ['string', 'Build']] },
  yaml(22, '        ', 'run', 'pnpm build'),
];

export function WorkflowScene() {
  const [geld, setGeld] = useState(true);
  return (
    <PrWindow tab="files" filesCount={1}>
      <div className="m-3 overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 font-mono text-xs">
          <FileCodeIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">.github/workflows/</span>ci.yml
          </span>
          <label className="inline-flex shrink-0 items-center gap-2 font-sans text-muted-foreground">
            {geld ? 'With Geld' : 'GitHub only'}
            <Switch checked={geld} onCheckedChange={setGeld} aria-label="Highlight shell in run blocks" />
          </label>
        </div>
        <div className="py-1 font-mono text-xs">
          {LINES.map((line, index) => (
            <div key={index} className={cn('flex whitespace-pre', line.kind === 'add' && 'bg-addition-muted/70', line.kind === 'del' && 'bg-deletion-muted/70')}>
              <span className="w-9 shrink-0 pr-2 text-right text-[0.6875rem] leading-5 text-muted-foreground tabular-nums select-none">{line.n}</span>
              <span className="w-4 shrink-0 text-center leading-5 text-muted-foreground select-none">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
              <code className="min-w-0 overflow-hidden leading-5 text-ellipsis whitespace-pre">
                {line.indent}
                {line.shell && !geld ? (
                  <span className={COLOR.string}>{line.segments.map(([, text]) => text).join('')}</span>
                ) : (
                  line.segments.map(([token, text], part) => (
                    <span key={part} className={cn('transition-colors duration-300', COLOR[token])}>
                      {text}
                    </span>
                  ))
                )}
              </code>
            </div>
          ))}
        </div>
      </div>
    </PrWindow>
  );
}
