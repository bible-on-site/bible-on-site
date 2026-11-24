FROM node:26.13.1-alpine AS base
# Bun ships as a standalone binary — copy the pinned release matching
# packageManager rather than installing a package manager.
COPY --from=oven/bun:1.4.5-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b /usr/local/bin/bun /usr/local/bin/bun

FROM base AS deps
WORKDIR /app
COPY admin/package.json admin/bun.lock admin/bunfig.toml ./
RUN bun install --frozen-lockfile --prefer-offline --ignore-scripts

FROM base AS builder
WORKDIR /app/admin
COPY --from=deps /app/node_modules ./node_modules
# Copy the main app and shared dependencies (maintaining ../shared import structure)
COPY admin/ ./
COPY shared/ ../shared/

ENV NODE_ENV=production
# Public website origin for browser-facing links — inlined into the bundle.
# Distinct from the runtime VITE_WEBSITE_URL, which names the cluster-internal
# revalidation endpoint (#2763).
ENV VITE_PUBLIC_WEBSITE_URL=https://xn--febl3a.co.il

# Optional assets CDN origin (ASSETS_BASE_URL), matching the website image.
# Empty/unset preserves the direct S3 fallback; see
# docs/aws/s3-delivery-cost-2026-11-01.md.
ARG ASSETS_BASE_URL
ENV ASSETS_BASE_URL=$ASSETS_BASE_URL

RUN bun run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Same baked default as the website runner: server code reads
# ASSETS_BASE_URL at request time, and a task-definition environment
# entry can still override it.
ARG ASSETS_BASE_URL
ENV ASSETS_BASE_URL=$ASSETS_BASE_URL

RUN apk add --no-cache curl~=8

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 adminjs

COPY --from=builder --chown=adminjs:nodejs /app/admin/.output ./.output

USER 1001

EXPOSE 3101

ENV PORT=3101
ENV HOST="0.0.0.0"

CMD ["node", ".output/server/index.mjs"]
