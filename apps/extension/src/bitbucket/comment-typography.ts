interface Typography {
  readonly base: string;
  readonly paragraph: string;
  readonly lineHeight: string;
}

interface Measurement {
  readonly ancestors: readonly HTMLElement[];
  readonly signature: string;
  readonly typography: Typography | null;
}

const measurements = new WeakMap<HTMLElement, Measurement>();
const BASE = '--ak-renderer-base-font-size';
const PARAGRAPH = '--ak-renderer-editor-font-normal-text';
const ROOT_LINE_HEIGHT = '--geld-bitbucket-body-line-height';

function px(value: string): boolean {
  return /^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) > 0 && Number.parseFloat(value) <= 128;
}

function readTypography(source: HTMLElement): Typography | null {
  const carrier = source.parentElement;
  const content = source.closest('[data-testid="comment-content"]');
  if (!source.isConnected || source.closest('[data-geld-ui]') !== null || carrier === null || carrier === content || content === null || !content.contains(carrier)) return null;
  const base = carrier.style.getPropertyValue(BASE).trim();
  const paragraph = carrier.style.getPropertyValue(PARAGRAPH).trim();
  // These are font-only properties from the native renderer carrier, never its layout/style attribute.
  if (!px(base) || paragraph.length === 0 || paragraph.length > 1024 || /[;{}\\]|(?:url|var|expression)\s*\(/i.test(paragraph)) return null;
  const probe = source.ownerDocument.createElement('span').style;
  probe.font = paragraph;
  if (probe.font === '') return null;

  const doc = source.ownerDocument;
  const view = doc.defaultView;
  const ancestors: HTMLElement[] = [];
  const context: string[] = [];
  for (let node: HTMLElement | null = source; node !== null; node = node.parentElement) {
    ancestors.push(node);
    context.push(node.className, node.getAttribute('style') ?? '', node.getAttribute('data-theme') ?? '', node.getAttribute('data-color-mode') ?? '');
  }
  // Window/visual-viewport dimensions do not force source layout or need document-lifetime listeners.
  const signature = JSON.stringify([context, view?.innerWidth, view?.innerHeight, view?.devicePixelRatio, view?.visualViewport?.width, view?.visualViewport?.height, view?.visualViewport?.scale]);
  const cached = measurements.get(source);
  if (cached?.signature === signature && cached.ancestors.length === ancestors.length && cached.ancestors.every((node, index) => node === ancestors[index])) return cached.typography;
  // Root line-height is a verified native font metric; paragraph line-height remains the live native font shorthand.
  const lineHeight = view?.getComputedStyle(source).lineHeight ?? '';
  const typography = px(lineHeight) ? { base, paragraph, lineHeight } : null;
  measurements.set(source, { ancestors, signature, typography });
  return typography;
}

/** Bind the exact verified native body's inherited typography to its owned clone host. */
export function bindBitbucketCommentTypography(source: HTMLElement | null, host: HTMLElement): void {
  const typography = source === null ? null : readTypography(source);
  for (const name of [BASE, PARAGRAPH, ROOT_LINE_HEIGHT]) host.style.removeProperty(name);
  host.toggleAttribute('data-geld-bitbucket-typography', typography !== null);
  if (typography === null) return;
  host.style.setProperty(BASE, typography.base);
  host.style.setProperty(PARAGRAPH, typography.paragraph);
  host.style.setProperty(ROOT_LINE_HEIGHT, typography.lineHeight);
}
