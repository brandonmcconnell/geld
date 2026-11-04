# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS builder
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=secret,id=proxy_ca,required=false --mount=type=cache,id=geld-pnpm-store,target=/root/.local/share/pnpm/store \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@10.33.3 && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @geld/dashboard build && pnpm --filter @geld/relay build && pnpm --filter @geld/relay exec esbuild ../../apps/dashboard/db/migrate.mjs --bundle --platform=node --format=cjs --external:pg-native --outfile=../../apps/dashboard/db/migrate.cjs --legal-comments=inline

FROM node:24-bookworm-slim AS dashboard
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001
COPY --from=builder --chown=node:node /src/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=node:node /src/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=node:node /src/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder --chown=node:node /src/apps/dashboard/db ./apps/dashboard/db
COPY --from=builder --chown=node:node /src/LICENSE ./LICENSE
USER node
EXPOSE 3001
CMD ["node", "apps/dashboard/server.js"]

FROM node:24-bookworm-slim AS relay
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /src/packages/relay/dist/cli.cjs ./cli.cjs
COPY --from=builder --chown=node:node /src/LICENSE ./LICENSE
USER node
EXPOSE 8080
CMD ["node", "cli.cjs", "broker"]
