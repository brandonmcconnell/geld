export interface OutlineHeading {
  /** Index of the heading among the body's blocks. */
  readonly index: number;
  readonly level: number;
  /** Index of the first block after this heading's section. */
  readonly end: number;
  /** The section holds headings of its own (it is open by default, so the tree shows). */
  readonly hasSubheadings: boolean;
}

/**
 * The heading level of a top-level block of rendered Markdown, or null. GitHub renders a heading either bare
 * (`<h2>`) or, on current github.com, wrapped with its anchor (`<div class="markdown-heading"><h2 class="heading-element">`).
 */
export function headingLevelOf(block: Element): number | null {
  const heading = headingElementOf(block);
  return heading === null ? null : Number(heading.tagName.slice(1));
}

export function headingElementOf(block: Element): HTMLElement | null {
  const isHeading = (element: Element | null): element is HTMLElement => element instanceof HTMLElement && /^H[1-6]$/.test(element.tagName);
  if (isHeading(block)) return block;
  if (block.classList.contains('markdown-heading') && isHeading(block.firstElementChild)) return block.firstElementChild;
  return null;
}

/** A section ends at the next sibling heading or explicit reset. */
export function outlineOf(blocks: readonly Element[], resets: ReadonlySet<number> = new Set(), levels: readonly (number | null)[] = blocks.map(headingLevelOf)): OutlineHeading[] {
  const outline: OutlineHeading[] = [];
  levels.forEach((level, index) => {
    if (level === null) return;
    let end = index + 1;
    let hasSubheadings = false;
    for (; end < levels.length; end++) {
      if (resets.has(end)) break;
      const next = levels[end];
      if (next === null || next === undefined) continue;
      if (next <= level) break;
      hasSubheadings = true;
    }
    if (end > index + 1) outline.push({ index, level, end, hasSubheadings });
  });
  return outline;
}

export function hiddenBlocks(outline: readonly OutlineHeading[], isOpen: (heading: OutlineHeading) => boolean): Set<number> {
  const hidden = new Set<number>();
  for (const heading of outline) {
    if (isOpen(heading)) continue;
    for (let index = heading.index + 1; index < heading.end; index++) hidden.add(index);
  }
  return hidden;
}
