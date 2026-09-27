FROM node:24.11.1-alpine@sha256:682368d8253e0c3364b803956085c456a612d738bd635926d73fa24db3ce53d7
WORKDIR /opt/s3-init
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY rustfs/init.mjs rustfs/config.mjs ./
USER node
ENTRYPOINT ["node", "init.mjs"]
