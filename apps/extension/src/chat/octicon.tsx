/** One of Geld's octicons (`github/ui/icons.ts`, constant markup of its own) as a React node, so the chat wears GitHub's icons. */
export function Octicon({ markup, className }: { readonly markup: string; readonly className?: string }) {
  return <span aria-hidden="true" className={className ?? 'inline-flex shrink-0'} dangerouslySetInnerHTML={{ __html: markup }} />;
}
