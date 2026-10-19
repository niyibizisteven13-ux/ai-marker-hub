# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm ci --no-audit --no-fund --prefer-offline --fetch-retries 5 --fetch-retry-mintimeout 20000
COPY . .
RUN npm run build
# Prune dev dependencies so node_modules contains production-only packages
RUN npm prune --production

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/eng.traineddata ./eng.traineddata
RUN npx prisma generate
RUN mkdir -p /app/data/generated /app/uploads /app/exports \
 && chown -R node:node /app/data /app/uploads /app/exports
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
