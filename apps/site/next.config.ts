import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @geld/core ships TypeScript source (see its package.json "exports").
  transpilePackages: ['@geld/core'],
  // Cache Components: everything is prerendered; the only "dynamic" piece is
  // the latest-release lookup, which is a `use cache` function revalidated in
  // the background so the pages stay static and instant.
  cacheComponents: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // The site has no raster images; the brand SVGs are served as-is.
    unoptimized: true,
  },
};

export default nextConfig;
