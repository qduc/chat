ARG NODE_IMAGE=node:20.18.0-alpine3.20
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package*.json ./
RUN chown -R node:node /app
USER node
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci

ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN chown -R node:node /app
USER node
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=node:node package*.json ./
RUN apk add --no-cache su-exec sqlite-libs \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN chmod +x entrypoint.sh
RUN mkdir -p logs && chown -R node:node logs
EXPOSE 3001
ENV INSTALL_ON_START=1
USER root
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm","run","dev"]

ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV INSTALL_ON_START=0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN apk add --no-cache su-exec \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN chmod +x entrypoint.sh
RUN mkdir -p logs && chown -R node:node logs
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3001}/health`).then(res => { if (res.ok) process.exit(0); process.exit(1); }).catch(() => process.exit(1));"]
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node","src/index.js"]
