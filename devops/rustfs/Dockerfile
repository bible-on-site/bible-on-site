FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
WORKDIR /opt/s3-init
COPY package.json bun.lock bunfig.toml ./
# Bun ships as a standalone binary — copy the pinned release matching
# packageManager (bun@1.4.4) rather than installing a package manager.
COPY --from=oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a /usr/local/bin/bun /usr/local/bin/bun
RUN bun install --frozen-lockfile --production
COPY rustfs/init.mjs rustfs/config.mjs ./
USER 1000
ENTRYPOINT ["node", "init.mjs"]
