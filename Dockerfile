FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN bun install --frozen-lockfile

COPY client/package*.json ./client/
RUN cd client && bun install --frozen-lockfile

COPY . .
RUN bun run scripts/build-content-bundle.mjs
RUN bun run scripts/build-mock-bundle.mjs
RUN cd client && bun run build

FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN bun install --production --frozen-lockfile

COPY server ./server
COPY content ./content
COPY migrations ./migrations
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 8080

USER bun

CMD ["bun", "run", "server/index.mjs"]
