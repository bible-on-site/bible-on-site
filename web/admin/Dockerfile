FROM node:24-alpine AS base

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

COPY --from=builder --chown=adminjs:nodejs /app/admin/dist ./dist

USER adminjs

EXPOSE 3101

ENV PORT=3101
ENV HOST="0.0.0.0"

CMD ["node", "dist/server/server.js"]
