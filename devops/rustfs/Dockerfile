FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /opt/s3-init
COPY package.json bun.lock bunfig.toml ./
# Bun ships as a standalone binary — copy the pinned release matching
# packageManager rather than installing a package manager.
COPY --from=oven/bun:1.4.5-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b /usr/local/bin/bun /usr/local/bin/bun
RUN bun install --frozen-lockfile --production
COPY rustfs/init.mjs rustfs/config.mjs ./
USER 1000
ENTRYPOINT ["node", "init.mjs"]
