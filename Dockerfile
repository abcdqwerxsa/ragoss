# CN-network mirror of node:24-slim; switch back to `node:24-slim` on unrestricted networks
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:24-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
# node_modules is installed (and better-sqlite3 compiled) on the host, then baked in —
# avoids flaky in-container npm registry access
COPY node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY config.example.json ./
# config.json is required at build time (gitignored; contains your real endpoints/keys).
# Image stays in your private Cloudflare registry — never push it to a public registry.
COPY config.json ./
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/server/app.ts"]
