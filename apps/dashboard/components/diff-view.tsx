'use client';
import type { PullDetail } from '@geld/domain';
import { z } from 'zod';
import { useState } from 'react';
import { ChevronDown, FileCode2, MessageSquare } from '@/components/icons';
import type { PlanFile, HunkRef } from '@geld/review/plan';
import { cn } from 'cn';
export function diffId(path: string): string {
  return `diff-${encodeURIComponent(path)}`;
}
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
  wrap = false,
  pull,
}: {
  readonly pull?: PullDetail;
  readonly files: readonly PlanFile[];
  readonly refs?: readonly HunkRef[];
  readonly onComment?: (line: LineSelection) => void;
  readonly supporting?: boolean;
  readonly wrap?: boolean;
}) {
  const selected = refs ? files.filter((file) => refs.some((ref) => ref.path === file.path)) : files;
  return (
    <div className={cn(supporting ? 'supporting-diffs' : 'diff-files', wrap && 'diff-wrap')}>
      {selected.map((file) => (
        <FileDiff
          key={`${file.path}:${pull?.headSha}:${pull?.baseSha}`}
          file={file}
          pull={pull}
          hunks={refs?.filter((ref) => ref.path === file.path).map((ref) => ref.hunk)}
          {...(onComment ? { onComment } : {})}
        />
      ))}
    </div>
  );
}
function FileDiff({
  file,
  pull,
  hunks,
  onComment,
}: {
  readonly file: PlanFile;
  readonly pull?: PullDetail | undefined;
  readonly hunks?: readonly number[] | undefined;
  readonly onComment?: (line: LineSelection) => void;
}) {
  const [open, setOpen] = useState(true);
  const [viewed, setViewed] = useState(false);
  const [source, setSource] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = file.status === 'deleted' ? pull?.baseSha : pull?.headSha;
  const sourcePath = file.status === 'deleted' ? (file.oldPath ?? file.path) : file.path;
  const query =
    pull && revision
      ? new URLSearchParams({
          ...pull.ref,
          number: String(pull.ref.number),
          path: sourcePath,
          revision,
        }).toString()
      : '';
  const repoUrl = pull
    ? `https://${pull.ref.host}/${pull.ref.owner.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(pull.ref.repo)}`
    : '';
  const fileUrl = `${repoUrl}/${pull?.ref.provider === 'gitlab' ? '-/blob' : pull?.ref.provider === 'bitbucket' ? 'src' : 'blob'}/${revision}/${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
  async function expand(index: number, side: 'above' | 'below') {
    if (!query || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!source) {
        const response = await fetch(`/api/pull/file?${query}`);
        if (!response.ok) throw new Error();
        const parsed = z.object({ lines: z.array(z.string()) }).parse(await response.json());
        setSource(parsed.lines);
      }
      setExpanded((previous) => ({
        ...previous,
        [`${index}:${side}`]: (previous[`${index}:${side}`] ?? 0) + 10,
      }));
    } catch {
      setError('Context could not be loaded. Refresh the review and try again.');
    } finally {
      setBusy(false);
    }
  }
  function contextEnd(index: number) {
    const hunk = file.hunks[index];
    return hunk
      ? Math.min(
          file.hunks[index + 1]?.newStart ?? (source?.length ?? 0) + 1,
          hunk.newStart + hunk.newLines + (expanded[`${index}:below`] ?? 0),
        )
      : 1;
  }
  function contextRows(start: number, end: number, offset: number, key: string) {
    return (
      source?.slice(start - 1, end - 1).map((text, index) => (
        <tr className="diff-line diff-line-context" key={`${key}:${start + index}`}>
          <td className="diff-number">{start + index + offset}</td>
          <td className="diff-number">{start + index}</td>
          <td />
          <td className="diff-code">
            <pre>{text || ' '}</pre>
          </td>
        </tr>
      )) ?? []
    );
  }
  return (
    <section className="diff-file" id={diffId(file.path)}>
      <header className="diff-file-header">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="diff-file-toggle"
          aria-expanded={open}
        >
          <ChevronDown size={14} className={open ? '' : '-rotate-90'} />
          <FileCode2 size={15} />
          <span>{file.path}</span>
        </button>
        <div className="diffstat">
          <span>+{file.additions}</span>
          <span>−{file.deletions}</span>
        </div>
        {pull && (
          <span className="diff-source-links">
            <a href={fileUrl} target="_blank" rel="noreferrer">
              Source
            </a>
            <a href={`/api/pull/file?${query}&raw=true`} target="_blank" rel="noreferrer">
              Raw
            </a>
          </span>
        )}
        <label className="viewed-control">
          <input
            name="viewed"
            type="checkbox"
            checked={viewed}
            onChange={(event) => setViewed(event.target.checked)}
          />
          Viewed
        </label>
      </header>
      {error && (
        <p className="inline-note" role="status">
          {error}
        </p>
      )}
      {open && (
        <div className="diff-scroll">
          {file.binary ? (
            <p className="diff-notice">
              Binary file changed. Open it on the provider to inspect the content.
            </p>
          ) : !file.hunks.length ? (
            <p className="diff-notice">
              {file.status === 'renamed' ? 'File renamed without text changes.' : 'File metadata changed.'}
            </p>
          ) : (
            <table className="diff-table" aria-label={`Changes in ${file.path}`}>
              <colgroup>
                <col className="diff-gutter" />
                <col className="diff-gutter" />
                <col className="diff-marker" />
                <col />
              </colgroup>
              <tbody>
                {file.hunks.flatMap((hunk, index) =>
                  hunks && !hunks.includes(index)
                    ? []
                    : [
                        ...(pull && !file.binary && file.status !== 'deleted'
                          ? [
                              <tr className="context-expand" key={`above-${index}`}>
                                <td colSpan={4}>
                                  <button
                                    type="button"
                                    disabled={
                                      busy ||
                                      hunk.newStart - (expanded[`${index}:above`] ?? 0) <=
                                        (index ? contextEnd(index - 1) : 1)
                                    }
                                    onClick={() => expand(index, 'above')}
                                  >
                                    Expand above
                                  </button>
                                </td>
                              </tr>,
                            ]
                          : []),
                        ...contextRows(
                          Math.max(
                            index ? contextEnd(index - 1) : 1,
                            hunk.newStart - (expanded[`${index}:above`] ?? 0),
                          ),
                          hunk.newStart,
                          hunk.oldStart - hunk.newStart,
                          `above-${index}`,
                        ),
                        <tr className="hunk-header" key={`header-${index}`}>
                          <td colSpan={4}>{hunk.header}</td>
                        </tr>,
                        ...hunk.lines.map((line, lineIndex) => (
                          <tr
                            className={cn('diff-line', `diff-line-${line.kind}`)}
                            key={`${index}-${lineIndex}`}
                          >
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
                                    type="button"
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
                        ...contextRows(
                          hunk.newStart + hunk.newLines,
                          Math.min(
                            file.hunks[index + 1]?.newStart ?? (source?.length ?? 0) + 1,
                            hunk.newStart + hunk.newLines + (expanded[`${index}:below`] ?? 0),
                          ),
                          hunk.oldStart + hunk.oldLines - hunk.newStart - hunk.newLines,
                          `below-${index}`,
                        ),
                        ...(pull && !file.binary && file.status !== 'deleted'
                          ? [
                              <tr className="context-expand" key={`below-${index}`}>
                                <td colSpan={4}>
                                  <button
                                    type="button"
                                    disabled={
                                      busy ||
                                      (source !== null &&
                                        hunk.newStart + hunk.newLines + (expanded[`${index}:below`] ?? 0) >=
                                          (file.hunks[index + 1]?.newStart ?? source.length + 1))
                                    }
                                    onClick={() => expand(index, 'below')}
                                  >
                                    Expand below
                                  </button>
                                </td>
                              </tr>,
                            ]
                          : []),
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
