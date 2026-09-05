import { cn } from 'cn';

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
 * served in dark mode via `<picture>` instead of recolouring anything.
 */
function BrandPicture({ asset, height, alt, className, priority }: BrandImageProps & { readonly asset: typeof WORDMARK }) {
  const width = Math.round((asset.width / asset.height) * height * 100) / 100;
  return (
    <picture className={cn('inline-block leading-none', className)}>
      <source media="(prefers-color-scheme: dark)" srcSet={asset.dark.pathname} />
      <img
        src={asset.light.pathname}
        width={width}
        height={height}
        alt={alt ?? 'Geld'}
        decoding="async"
        fetchPriority={priority === true ? 'high' : 'auto'}
      />
    </picture>
  );
}

export function Wordmark(props: BrandImageProps) {
  return <BrandPicture asset={WORDMARK} {...props} />;
}

export function Logomark(props: BrandImageProps) {
  return <BrandPicture asset={LOGOMARK} {...props} />;
}
