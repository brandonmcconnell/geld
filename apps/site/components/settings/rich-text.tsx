import { splitInlineCode } from '@geld/core';

/** Schema copy with `backticks` rendered as code chips and **asterisks** as emphasis. */
export function RichText({ copy }: { readonly copy: string }) {
  return (
    <>
      {splitInlineCode(copy).map((run, index) => {
        switch (run.kind) {
          case 'code':
            return (
              <code key={index} className="code-chip">
                {run.text}
              </code>
            );
          case 'strong':
            return (
              <strong key={index} className="font-semibold text-foreground">
                {run.text}
              </strong>
            );
          case 'text':
            return <span key={index}>{run.text}</span>;
        }
      })}
    </>
  );
}
