# Dependencies stage: better-sqlite3 is a native module. It normally downloads
# a prebuilt binary, but the build tools are here as a fallback so the image
# still builds if no prebuilt matches.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/sisyphus.db
WORKDIR /app
COPY backend backend
COPY frontend frontend
COPY --from=deps /app/backend/node_modules backend/node_modules

# The SQLite file lives in /data so it survives image updates (mount a volume).
# /backups is where scripts/backup.js writes (bind-mounted from the host).
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME /data
EXPOSE 3000

# Run from backend/ so the admin commands work as plain npm scripts:
#   docker compose exec app npm run add-user -- alice
WORKDIR /app/backend

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
