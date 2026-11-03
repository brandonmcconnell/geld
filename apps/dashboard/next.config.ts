import type { NextConfig } from 'next';
const config: NextConfig = {
  cacheComponents: true,
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  logging: { incomingRequests: false },
  transpilePackages: [
    '@geld/core',
    '@geld/github',
    '@geld/review',
    '@geld/domain',
    '@geld/providers',
    '@geld/ui',
    '@geld/relay',
  ],
  serverExternalPackages: ['posthog-js'],
  outputFileTracingExcludes: {
    '*': ['../../.private/**', '../../.git/**', './.env*'],
  },
  outputFileTracingIncludes: {
    '/api/measurement/sdk': ['./node_modules/posthog-js/dist/array.js'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
// Vercel's adapter emits its own function bundles.
if (process.env.VERCEL !== '1') config.output = 'standalone';
export default config;
