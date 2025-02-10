# syntax=docker.io/docker/dockerfile:1

FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# might be needed if issues are arising mostly with proccess.dlopen
# RUN apk add --no-cache libc6-compat=1.2.2-r9
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN \
    if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
    else echo "Lockfile not found." && exit 1; \
    fi


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN \
    if [ -f package-lock.json ]; then npm run build; \
    else echo "Lockfile not found." && exit 1; \
    fi

# Production image, copy all the files and run nennENV NODE_ENV=production/aENV NEXT_TELEMETRY_DISABLED=1pptiRUN addgroup --system --gid 1001 nodejsEDRUN adduser --system --uid 1001 nextjs=1deCOPY --from=builder /app/public ./publicxtjs# Automatically leverage output traces to reduce image sizebl# https://nextjs.org/docs/advanced-features/output-file-tracingicCOPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./siCOPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/staticcie USER nextjsaticEXPOSE 3000xtjsENV PORT=30003000# server.js is created by next build from the standalone output30# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output00ENV HOSTNAME="0.0.0.0"tpCMD ["node", "server.js"]tp"]
