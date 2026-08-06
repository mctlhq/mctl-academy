FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:preview || true

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/content ./content

EXPOSE 8080

USER node

CMD ["node", "-e", "import('http').then(h => h.createServer((req, res) => { if (req.url === '/healthz') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({ status: 'ok', service: 'mctl-academy' })); } else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<h1>mctl Academy</h1><p>Free, English-first practice for agentic AI certification</p>'); } }).listen(process.env.PORT || 8080, () => console.log('mctl-academy running on port ' + (process.env.PORT || 8080))));"]
