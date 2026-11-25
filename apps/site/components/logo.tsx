import { cn } from 'cn';
import type { ComponentProps } from 'react';

import logo from '../../../assets/brand/geld-logo.svg';
import logoWhite from '../../../assets/brand/geld-logo-white.svg';
import logomark from '../../../assets/brand/geld-logomark.svg';
import logomarkWhite from '../../../assets/brand/geld-logomark-white.svg';

function assetSource(asset: unknown): string {
  if (typeof asset === 'string') return asset;
  if (asset !== null && typeof asset === 'object' && 'src' in asset && typeof asset.src === 'string') return asset.src;
  throw new Error('Missing brand asset URL');
}

const WORDMARK = {
  light: assetSource(logo),
  dark: assetSource(logoWhite),
  // viewBox of the SVG, for the intrinsic aspect ratio.
  width: 95,
  height: 25,
};

const LOGOMARK = {
  light: assetSource(logomark),
  dark: assetSource(logomarkWhite),
  width: 24,
  height: 25,
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
    <span data-brand-logo="" className={cn('inline-block leading-none', className)}>
      <img src={asset.light} alt={text} className="dark:hidden" {...shared} />
      <img src={asset.dark} alt={text} className="hidden dark:block" {...shared} />
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
