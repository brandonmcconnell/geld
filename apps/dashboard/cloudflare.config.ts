import { bindings, defineConfig, defineWorker } from 'cf/config';

export default defineConfig(({ isPreview, mode }) => {
  const preview = isPreview || mode === 'preview';
  const primary = preview ? undefined : process.env.GELD_HYPERDRIVE_ID;
  const customer = preview ? undefined : process.env.GELD_CUSTOMER_CONTENT_HYPERDRIVE_ID;
  const secrets = preview
    ? []
    : [
        ...(primary ? ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'TOKEN_ENCRYPTION_KEY'] : []),
        ...(process.env.GELD_DASHBOARD_SECRET_NAMES ?? '').split(',').map((name) => name.trim()).filter(Boolean),
      ];
  return {
    worker: defineWorker({
      name: process.env.GELD_DASHBOARD_WORKER_NAME || (preview ? 'geld-dashboard-preview' : 'geld-dashboard'),
      entrypoint: './worker/index.ts',
      compatibilityDate: '2026-11-24',
      workersDev: mode === 'preview',
      previewUrls: false,
      assets: {
        htmlHandling: 'none',
        notFoundHandling: 'none',
        runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
      },
      env: {
        ...Object.fromEntries(secrets.map((name) => [name, bindings.secret()])),
        ASSETS: bindings.assets(),
        ...(primary ? { GELD_DATABASE: bindings.hyperdrive({ id: primary }) } : {}),
        ...(customer ? { GELD_CUSTOMER_CONTENT_DATABASE: bindings.hyperdrive({ id: customer }) } : {}),
      },
    }),
  };
});
