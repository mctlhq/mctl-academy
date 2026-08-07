FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY client/package*.json ./client/
RUN cd client && npm ci --include=optional

COPY . .
RUN node scripts/build-content-bundle.mjs
RUN node scripts/build-mock-bundle.mjs
RUN cd client && npx vite build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 8080

USER node

CMD ["node", "server/index.mjs"]
