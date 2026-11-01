'use client';
import { useState } from 'react';
import { ChevronDown, FileCode2, MessageSquare } from 'lucide-react';
import type { PlanFile, HunkRef } from '@geld/review/plan';
import { cn } from 'cn';
export interface LineSelection {
  readonly oldPath: string;
  readonly path: string;
  readonly line: number;
  readonly side: 'old' | 'new';
}
export function DiffView({
  files,
  refs,
  onComment,
  supporting = false,
}: {
  readonly files: readonly PlanFile[];
  readonly refs?: readonly HunkRef[];
  readonly onComment?: (line: LineSelection) => void;
  readonly supporting?: boolean;
}) {
  const selected = refs ? files.filter((file) => refs.some((ref) => ref.path === file.path)) : files;
  return (
    <div className={supporting ? 'supporting-diffs' : 'diff-files'}>
      {selected.map((file) => (
        <FileDiff
          key={file.path}
          file={file}
          hunks={refs?.filter((ref) => ref.path === file.path).map((ref) => ref.hunk)}
          {...(onComment ? { onComment } : {})}
        />
      ))}
    </div>
  );
}
export function DiffView({
  files,
  refs,
  onComment,
  supporting = false,
}: {
  readonly files: readonly PlanFile[];
  readonly refs?: readonly HunkRef[];
  readonly onComment?: (line: LineSelection) => void;
  readonly supporting?: boolean;
}) {
  const selected = refs ? files.filter((file) => refs.some((ref) => ref.path === file.path)) : files;
  return (
    <div className={supporting ? 'supporting-diffs' : 'diff-files'}>
      {selected.map((file) => (
        <FileDiff
          key={file.path}
          file={file}
          hunks={refs?.filter((ref) => ref.path === file.path).map((ref) => ref.hunk)}
          {...(onComment ? { onComment } : {})}
        />
      ))}
    </div>
  );
}
function FileDiff({
  file,
  hunks,
  onComment,
}: {
  readonly file: PlanFile;
  readonly hunks?: readonly number[] | undefined;
  readonly onComment?: (line: LineSelection) => void;
}) {
  const [open, setOpen] = useState(true);
  const [viewed, setViewed] = useState(false);
  return (
    <section className="diff-file">
      <header className="diff-file-header">
        <button onClick={() => setOpen((value) => !value)} className="diff-file-toggle" aria-expanded={open}>
          <ChevronDown size={14} className={open ? '' : '-rotate-90'} />
          <FileCode2 size={15} />
          <span>{file.path}</span>
        </button>
        <div className="diffstat">
          <span>+{file.additions}</span>
          <span>−{file.deletions}</span>
        </div>
        <label className="viewed-control">
          <input type="checkbox" checked={viewed} onChange={(event) => setViewed(event.target.checked)} />
          Viewed
        </label>
      </header>
      {open && (
        <div className="diff-scroll">
          {file.binary ? (
            <p className="diff-notice">Binary file changed. Open it on the provider to inspect the content.</p>
          ) : !file.hunks.length ? (
            <p className="diff-notice">
              {file.status === 'renamed' ? 'File renamed without text changes.' : 'File metadata changed.'}
            </p>
          ) : (
            <table className="diff-table" aria-label={`Changes in ${file.path}`}>
              <tbody>
                {file.hunks.flatMap((hunk, index) =>
                  hunks && !hunks.includes(index)
                    ? []
                    : [
                        <tr className="hunk-header" key={`header-${index}`}>
                          <td colSpan={4}>{hunk.header}</td>
                        </tr>,
                        ...hunk.lines.map((line, lineIndex) => (
                          <tr className={cn('diff-line', `diff-line-${line.kind}`)} key={`${index}-${lineIndex}`}>
                            <td className="diff-number">{line.oldLine}</td>
                            <td className="diff-number">{line.newLine}</td>
                            <td className="diff-sign">
                              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                            </td>
                            <td className="diff-code">
                              <pre>{line.text || ' '}</pre>
                              {onComment &&
                                line.kind !== 'notice' &&
                                (line.newLine !== null || line.oldLine !== null) && (
                                  <button
                                    className="line-comment-button"
                                    aria-label={`Comment on ${file.path} line ${line.newLine ?? line.oldLine}`}
                                    onClick={() =>
                                      onComment({
                                        oldPath: file.oldPath ?? file.path,
                                        path: file.path,
                                        line: line.newLine ?? line.oldLine ?? 1,
                                        side: line.kind === 'removed' ? 'old' : 'new',
                                      })
                                    }
                                  >
                                    <MessageSquare size={13} />
                                  </button>
                                )}
                            </td>
                          </tr>
                        )),
                      ],
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
