ARG NODE_IMAGE=node:20.18.0-alpine3.20

# --- Frontend Build Stage ---
FROM ${NODE_IMAGE} AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
ENV NEXT_PUBLIC_API_BASE=/api
RUN npm run build

# --- Backend Build Stage ---
FROM ${NODE_IMAGE} AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# --- Final Stage ---
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache su-exec sqlite-libs

# Copy backend dependencies
COPY --from=backend-builder --chown=node:node /app/backend/node_modules ./node_modules

# Copy backend source
COPY --chown=node:node backend/ .

# Copy frontend build to backend/public
COPY --from=frontend-builder --chown=node:node /app/frontend/out ./public

# Setup permissions and directories
RUN mkdir -p logs && chown -R node:node /app
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV INSTALL_ON_START=0

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health`).then(res => { if (res.ok) process.exit(0); process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node","src/index.js"]
