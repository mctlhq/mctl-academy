FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY client/package*.json ./client/
RUN cd client && npm ci --include=optional

COPY . .
RUN cd client && npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN npm install -g sirv-cli

COPY --from=builder /app/client/dist ./client/dist

EXPOSE 8080

USER node

CMD ["sirv", "client/dist", "--port", "8080", "--host", "0.0.0.0", "--single"]


