FROM node:26.10.0-alpine AS base

# Version-only releases must not invalidate the dependency layer.
FROM base AS manifests
WORKDIR /app
COPY bible-on-site/package.json bible-on-site/package-lock.json ./
RUN node -e 'const fs = require("node:fs"); for (const file of ["package.json", "package-lock.json"]) { const json = JSON.parse(fs.readFileSync(file)); delete json.version; if (json.packages) delete json.packages[""].version; fs.writeFileSync(file, JSON.stringify(json)); }'

# Install dependencies only when needed
FROM base AS deps
# might be needed if issues are arising mostly with proccess.dlopen
# RUN apk add --no-cache libc6-compat=1.2.2-r9
WORKDIR /app

# Install dependencies based on the preferred package manager
# Build context is web/, so bible-on-site is a subdirectory
COPY --from=manifests /app/package.json /app/package-lock.json ./
COPY bible-on-site/.npmrc* ./
# Install ALL dependencies (including dev like sass) needed for the build step.
# The final runner stage uses Next.js standalone output, so dev deps don't end up in production.
# Source-dependent postinstall helpers run outside this dependency-only stage.
# prebuild derives the browser catalog after the full source is copied.
RUN npm ci --prefer-offline --ignore-scripts

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app/bible-on-site
COPY --from=deps /app/node_modules ./node_modules
# Copy the main app and shared dependencies (maintaining ../shared import structure)
COPY bible-on-site/ ./
COPY shared/ ../shared/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# DB_URL is passed at build time for SSG pages that need database access
# This enables generateStaticParams to fetch data during `npm run build`
ARG DB_URL
ENV DB_URL=$DB_URL

# NEXT_PUBLIC_ENV must be set at build time: NEXT_PUBLIC_* vars are inlined by
# Next.js during `npm run build`, and statically-rendered pages bake in this
# value. Without it, isProduction() evaluates to false in the built image and
# production-only features (e.g. Google Analytics) are silently disabled even
# though the ECS task definition sets NEXT_PUBLIC_ENV at runtime. Defaults to
# production (this image is the production artifact); override via --build-arg.
ARG NEXT_PUBLIC_ENV=production
ENV NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV

# The public Mapbox token is embedded into client bundles by Next.js at build time.
# This argument is intentionally public, so the secret build-argument rule does not apply.
# nosemgrep
# hadolint ignore=DL3064
ARG MAPBOX_PUBLIC_KEY
# hadolint ignore=DL3064
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$MAPBOX_PUBLIC_KEY

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install curl for ECS health checks
RUN apk add --no-cache curl~=8

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/bible-on-site/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/bible-on-site/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/bible-on-site/.next/static ./.next/static

USER 1001

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Load canonical server data before a replacement is eligible for traffic.
# Keep these settings aligned with the ECS container health check.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --start-interval=30s --retries=5 \
    CMD ["curl", "-sf", "--max-time", "5", "http://localhost:3000/api/health/ready"]

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
CMD ["node", "server.js"]
