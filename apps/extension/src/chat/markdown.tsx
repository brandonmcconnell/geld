import type { ComponentProps } from 'react';
import type { ExtraProps, UrlTransform } from 'streamdown';
import { Streamdown } from 'streamdown';
import { codeHighlighter } from './highlight';
import { usePortalContainer } from './portal';

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Links and image addresses keep only the protocols a reply has any business with; anything else (`javascript:`, `data:`) is dropped. */
export function safeUrl(url: string): string {
  try {
    return SAFE_PROTOCOLS.has(new URL(url, location.href).protocol) ? url : '';
  } catch {
    return '';
  }
}

const urlTransform: UrlTransform = (url) => safeUrl(url);

/**
 * An image in a reply is shown as its words and address, never loaded: a model whose context held text an attacker
 * wrote can be made to emit an image whose address carries the conversation, fetched the moment it renders.
 */
function ImageStandIn({ alt, src }: ComponentProps<'img'> & ExtraProps) {
  const words = [alt === undefined || alt === '' ? 'Image' : `Image: ${alt}`, typeof src === 'string' && src !== '' ? `(${src})` : ''].filter((part) => part !== '').join(' ');
  return (
    <span className="text-muted-foreground italic" title="Images in replies are not loaded">
      {words}
    </span>
  );
}

function Link({ href, children, node: _node, ...props }: ComponentProps<'a'> & ExtraProps) {
  if (href === undefined || href === '') return <span>{children}</span>;
  return (
    <a {...props} href={href} target="_blank" rel="noreferrer" className="font-medium text-(--fgColor-accent) underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

const COMPONENTS = { img: ImageStandIn, a: Link };
const PLUGINS = { code: codeHighlighter };
const CONTROLS = { code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false }, mermaid: false };

/** A reply's Markdown, rendered as it streams: Streamdown closes what is still open (a fence, a list, emphasis) so a partial reply reads whole. */
export function Markdown({ children, streaming }: { readonly children: string; readonly streaming: boolean }) {
  const portal = usePortalContainer();
  return (
    <Streamdown
      className="geld-chat-markdown min-w-0 text-sm leading-relaxed"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      {...(streaming ? { caret: 'block' as const } : {})}
      components={COMPONENTS}
      plugins={PLUGINS}
      controls={CONTROLS}
      linkSafety={{ enabled: false }}
      urlTransform={urlTransform}
      portal={portal}
    >
      {children}
    </Streamdown>
  );
}
