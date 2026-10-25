FROM node:26.12.1-alpine AS base
# Node 26 no longer bundles corepack; install it from npm to activate the
# pinned pnpm from packageManager.
RUN npm install -g corepack@0.36.0 && corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY admin/package.json admin/pnpm-lock.yaml admin/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prefer-offline --ignore-scripts

FROM base AS builder
WORKDIR /app/admin
COPY --from=deps /app/node_modules ./node_modules
COPY admin/ ./

ENV NODE_ENV=production
RUN pnpm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache curl~=8

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 adminjs

COPY --from=builder --chown=adminjs:nodejs /app/admin/.output ./.output

USER 1001

EXPOSE 3101

ENV PORT=3101
ENV HOST="0.0.0.0"

CMD ["node", ".output/server/index.mjs"]
