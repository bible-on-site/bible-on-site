# syntax=docker.io/docker/dockerfile:1

FROM node:24-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# might be needed if issues are arising mostly with proccess.dlopen
# RUN apk add --no-cache libc6-compat=1.2.2-r9
WORKDIR /app

# Install dependencies based on the preferred package manager
# Build context is web/, so bible-on-site is a subdirectory
COPY bible-on-site/package.json bible-on-site/package-lock.json ./
COPY bible-on-site/.npmrc* ./
# TODO can pass the entire npm cache
RUN npm ci --omit=dev --prefer-offline

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app/bible-on-site
COPY --from=deps /app/node_modules ./node_modules
# Copy the main app and shared dependencies (maintaining ../shared import structure)
COPY bible-on-site/ ./
COPY shared/ ../shared/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/bible-on-site/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/bible-on-site/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/bible-on-site/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
CMD ["node", "server.js"]