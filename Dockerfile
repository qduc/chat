ARG NODE_IMAGE=node:22.18.0-bookworm-slim

# --- Frontend Build Stage ---
FROM ${NODE_IMAGE} AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ .
ENV NEXT_PUBLIC_API_BASE=/api \
    NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/app/frontend/.next/cache \
    npm run build

# --- Backend Build Stage ---
FROM ${NODE_IMAGE} AS backend-builder
WORKDIR /app/backend

# Install build dependencies for native modules
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y python3 make g++

COPY backend/package*.json ./

# Clean install to ensure proper compilation in container
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/root/.cache/node-gyp \
    npm ci --omit=dev

# Verify better-sqlite3 was built correctly
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 loaded successfully')"

# --- Final Stage ---
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Install runtime dependencies (gosu is Debian equivalent of su-exec)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y gosu libsqlite3-0

# Copy backend dependencies
COPY --from=backend-builder --chown=node:node /app/backend/node_modules ./node_modules

# Copy backend source
COPY --chown=node:node backend/ .

# Copy frontend build to backend/public
COPY --from=frontend-builder --chown=node:node /app/frontend/out ./public

# Setup permissions and directories
RUN mkdir -p logs && chown node:node logs
RUN mkdir -p /data && chown node:node /data
RUN chmod +x entrypoint.sh && chown node:node entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV INSTALL_ON_START=0

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health`).then(res => { if (res.ok) process.exit(0); process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node","src/index.js"]
