FROM node:24-slim AS deps
corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-slim
ENV NODE_ENV=production
corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY config.example.json ./
EXPOSE 8080
# config.json mounted or baked at deploy time; PORT is set by Cloud Run
CMD ["pnpm", "start"]
