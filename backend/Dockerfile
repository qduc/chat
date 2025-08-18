## Backend Dockerfile (production)
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
