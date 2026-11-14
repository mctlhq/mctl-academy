FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY client/package.json client/bun.lock client/.npmrc ./client/
# client/ depends on @mctlhq/ui from GitHub Packages; theme CSS comes from
# the ui.mctl.ai CDN. The secret is only injected for this repo by
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
# server/spa.mjs renders course pages with the client's own head-tag builder
# and route list, and checks course ids against the generated catalog. The
# server refuses to boot without them, so they ship next to client/dist.
COPY --from=builder /app/client/src/seo ./client/src/seo
COPY --from=builder /app/client/src/course-catalog.json ./client/src/course-catalog.json

EXPOSE 8080

USER bun

CMD ["bun", "run", "server/index.mjs"]
