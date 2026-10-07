import type { InlineMark } from '@geld/review';
import { parseInlineMarkdown } from '@geld/review';

const TAG: Readonly<Record<InlineMark, 'code' | 'strong' | 'em' | 'del'>> = { code: 'code', strong: 'strong', em: 'em', del: 'del' };

/**
 * One line of comment text as DOM: `code`, **bold**, *italic* and
 * ~~struck~~ become the matching elements, nested as written, so a title or
 * preview keeps the formatting its author gave it. Plain text stays a text
 * node. Everything the panel shows that comes out of a comment — titles,
 * previews, a pinned source's first line — goes through here.
 */
export function inlineText(text: string): readonly Node[] {
  return parseInlineMarkdown(text).map((run) => {
    let node: Node = document.createTextNode(run.text);
    // Innermost mark closest to the text.
    for (const mark of [...run.marks].reverse()) {
      const element = document.createElement(TAG[mark]);
      element.append(node);
      node = element;
    }
    return node;
  });
}
