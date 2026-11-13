# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle

RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S smartguide && adduser -S smartguide -G smartguide \
  && mkdir -p /app/uploads \
  && chown -R smartguide:smartguide /app

COPY --from=builder --chown=smartguide:smartguide /app/package.json ./
COPY --from=builder --chown=smartguide:smartguide /app/node_modules ./node_modules
COPY --from=builder --chown=smartguide:smartguide /app/dist ./dist
COPY --from=builder --chown=smartguide:smartguide /app/drizzle ./drizzle

USER smartguide

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.API_PORT||3001;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
