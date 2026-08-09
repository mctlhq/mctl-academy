FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY client/package.json client/bun.lock client/.npmrc ./client/
# client/ depends on @mctlhq/ui and @mctlhq/css from GitHub Packages
# (Track C — see PLAN.md). The secret is only injected for this repo by
# mctl-gitops's build-image.yaml allow-list; on any other build context the
# mount resolves empty and this becomes a normal public-package install.
RUN --mount=type=secret,id=github_token \
    GITHUB_PACKAGES_TOKEN="$(cat /run/secrets/github_token 2>/dev/null || true)" \
    sh -c 'cd client && bun install --frozen-lockfile'

COPY . .
RUN bun run scripts/build-content-bundle.mjs
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
