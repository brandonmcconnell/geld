import { cn } from 'cn';
import type { ComponentProps } from 'react';

/**
 * Brand assets live in `assets/brand/` at the repository root and are shared
 * with the extension. `new URL(..., import.meta.url)` lets the bundler copy
 * them into the static output with hashed names (and keeps them typed as
 * `URL` rather than the `any` the `*.svg` module declaration would give us).
 */
const WORDMARK = {
  light: new URL('../../../assets/brand/geld-logo.svg', import.meta.url),
  dark: new URL('../../../assets/brand/geld-logo-white.svg', import.meta.url),
  // viewBox of the SVG, for the intrinsic aspect ratio.
  width: 141.91,
  height: 36.31,
};

const LOGOMARK = {
  light: new URL('../../../assets/brand/geld-logomark.svg', import.meta.url),
  dark: new URL('../../../assets/brand/geld-logomark-white.svg', import.meta.url),
  width: 134.41,
  height: 157.21,
};

interface BrandImageProps {
  readonly className?: string | undefined;
  /** Rendered height in CSS pixels; width follows the asset's aspect ratio. */
  readonly height: number;
  /** Defaults to "Geld"; pass an empty string when the image is decorative. */
  readonly alt?: string | undefined;
  readonly priority?: boolean | undefined;
}

/**
 * The brand SVGs are pure black with white variants, so the white file is
 * shown in dark mode instead of recolouring anything. Both are rendered and
 * toggled with the `dark:` variant so the swap follows the theme menu as well
 * as the OS (a `<picture>` media query would only follow the OS).
 */
function BrandPicture({ asset, height, alt, className, priority }: BrandImageProps & { readonly asset: typeof WORDMARK }) {
  const width = Math.round((asset.width / asset.height) * height * 100) / 100;
  const shared: Pick<ComponentProps<'img'>, 'width' | 'height' | 'decoding' | 'fetchPriority'> = {
    width,
    height,
    decoding: 'async',
    fetchPriority: priority === true ? 'high' : 'auto',
  };
  const text = alt ?? 'Geld';
  // Static SVGs: nothing for next/image to optimise, and both files are ~1 KB.
  /* eslint-disable @next/next/no-img-element */
  return (
    <span className={cn('inline-block leading-none', className)}>
      <img src={asset.light.pathname} alt={text} className="dark:hidden" {...shared} />
      <img src={asset.dark.pathname} alt={text} className="hidden dark:block" {...shared} />
    </span>
  );
  /* eslint-enable @next/next/no-img-element */
}

export function Wordmark(props: BrandImageProps) {
  return <BrandPicture asset={WORDMARK} {...props} />;
}

export function Logomark(props: BrandImageProps) {
  return <BrandPicture asset={LOGOMARK} {...props} />;
}
