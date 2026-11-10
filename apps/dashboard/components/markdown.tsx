'use client';
import { Streamdown } from 'streamdown';
import type { ReactNode } from 'react';
const components = {
  strong: ({ children }: { readonly children?: ReactNode }) => <strong>{children}</strong>,
};
export function Markdown({
  children,
  streaming = false,
}: {
  readonly children: string;
  readonly streaming?: boolean;
}) {
  return (
    <Streamdown
      className="review-markdown [&_div]:rounded-none"
      components={components}
      mode={streaming ? 'streaming' : 'static'}
      skipHtml
      controls={false}
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
    >
      {children}
    </Streamdown>
  );
}
