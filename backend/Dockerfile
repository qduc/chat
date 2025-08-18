## Backend Dockerfile (production + dev)

# --- Dev stage: optimized for live development ---
FROM node:20-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN npm install
# Copy source for dev (mounted again via volume in compose)
COPY src ./src
COPY .env.example ./
EXPOSE 3001
CMD ["npm", "run", "dev"]

# --- Prod stage: lean runtime image (default/final) ---
FROM node:20-alpine AS base
WORKDIR /app

# Allow dev builds to install devDependencies by toggling INSTALL_PROD build-arg.
ARG INSTALL_PROD=true
# Install dependencies. In production builds we omit dev deps, in dev builds pass INSTALL_PROD=false.
COPY package*.json ./
RUN if [ "$INSTALL_PROD" = "true" ]; then npm install --omit=dev; else npm install; fi

# Copy source
COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
EXPOSE 3001

# Default command
CMD ["node", "src/index.js"]
