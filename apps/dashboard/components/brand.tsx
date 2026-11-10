const wordmark = {
  light: new URL('../../../assets/brand/geld-logo.svg', import.meta.url),
  dark: new URL('../../../assets/brand/geld-logo-white.svg', import.meta.url),
};
export function Brand({ compact = false }: { readonly compact?: boolean }) {
  const height = compact ? 16 : 24;
  const width = (height * 95) / 25;
  return (
    <span className="brand" aria-label="Geld">
      {/* Static SVG assets are shared with the marketing site. */}
      {/* eslint-disable @next/next/no-img-element */}
      <img src={wordmark.light.pathname} width={width} height={height} alt="" className="dark:hidden" />
      <img src={wordmark.dark.pathname} width={width} height={height} alt="" className="hidden dark:block" />
      {/* eslint-enable @next/next/no-img-element */}
    </span>
  );
}
