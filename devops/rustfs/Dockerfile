FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
WORKDIR /opt/s3-init
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Node 26 no longer bundles corepack; install it from npm to activate the
# pinned pnpm from packageManager.
RUN npm install -g corepack@0.36.0 && corepack enable pnpm && pnpm install --frozen-lockfile --prod
COPY rustfs/init.mjs rustfs/config.mjs ./
USER 1000
ENTRYPOINT ["node", "init.mjs"]
