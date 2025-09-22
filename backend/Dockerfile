# 1) Install deps as the node user
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# Give node permission to write in /app, then switch user
RUN chown -R node:node /app
USER node
# optional cache in alpine: add --no-audit --no-fund to speed up
RUN npm ci

# 2) Dev stage (also runs as node, writes caches safely)
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
ENV PORT=3000
COPY --chown=node:node package*.json ./
COPY --chown=node:node entrypoint.sh ./
RUN chmod +x entrypoint.sh
# bring in node_modules that are already node-owned
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# now copy the rest of the app as node-owned
COPY --chown=node:node . .
USER node
EXPOSE 3000
ENTRYPOINT ["sh","./entrypoint.sh"]
CMD ["npm","run","dev"]

# 3) Build stage (root is fine here, no runtime writes)
FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE
ARG BACKEND_ORIGIN
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}
# use deps’ node_modules to avoid re-install
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 4) Runner stage (copy runtime deps + build output, run as node)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# if you need node_modules at runtime, copy them now:
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# copy build artifacts
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package*.json ./

# no prune needed if deps were already prod-only; otherwise:
# RUN npm prune --omit=dev

USER node
EXPOSE 3000
CMD ["npm","run","start"]
