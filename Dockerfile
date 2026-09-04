# Aetheris One — production image (Next.js 15, Node 22; node:sqlite is used by the knowledge fabric)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 AETHERIS_DATA_DIR=/data PORT=3000
RUN useradd -m aetheris && mkdir -p /data && chown aetheris /data
COPY --from=build --chown=aetheris /app/package.json ./
COPY --from=build --chown=aetheris /app/node_modules ./node_modules
COPY --from=build --chown=aetheris /app/.next ./.next
COPY --from=build --chown=aetheris /app/public ./public
COPY --from=build --chown=aetheris /app/next.config.* ./
USER aetheris
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
