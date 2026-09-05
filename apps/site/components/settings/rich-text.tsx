import { splitInlineCode } from '@geld/core';

/** Schema copy with `backticks` rendered as code chips. */
export function RichText({ copy }: { readonly copy: string }) {
  return (
    <>
      {splitInlineCode(copy).map((run, index) =>
        run.kind === 'code' ? (
          <code key={index} className="code-chip">
            {run.text}
          </code>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}
