import { bindings, defineConfig, defineWorker } from 'cf/config';

const name = process.env.CLOUDFLARE_WORKER_NAME ?? 'geld-site';

export default defineConfig({
  worker: defineWorker({
    name,
    entrypoint: 'vinext/server/fetch-handler',
    compatibilityDate: '2026-11-25',
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: false },
    },
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
    },
    env: {
      ASSETS: bindings.assets(),
      VINEXT_KV_CACHE: bindings.kv(),
    },
  }),
});
