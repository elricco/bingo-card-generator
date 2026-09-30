FROM node:20-alpine AS frontend-build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bingo/web build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
COPY --from=frontend-build /app/apps/web/dist ./apps/web/dist
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@bingo/api", "start"]
