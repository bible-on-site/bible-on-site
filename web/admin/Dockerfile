# Node pinned to the held engines range (>=24.11.1 <24.12.0, see renovate.json /
# issue #985): a floating node:24 tag gave the packaging `npm ci` a newer, stricter
# npm than PR CI (which resolves node from engines), letting lockfile desyncs merge
# green and then break master.
FROM node:24.11.1-alpine AS base

FROM base AS deps
WORKDIR /app
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --prefer-offline --ignore-scripts

FROM base AS builder
WORKDIR /app/admin
COPY --from=deps /app/node_modules ./node_modules
COPY admin/ ./

ENV NODE_ENV=production
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache curl

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 adminjs

COPY --from=builder --chown=adminjs:nodejs /app/admin/.output ./.output

USER adminjs

EXPOSE 3101

ENV PORT=3101
ENV HOST="0.0.0.0"

CMD ["node", ".output/server/index.mjs"]
