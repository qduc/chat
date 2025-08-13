## Backend Dockerfile (production)
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies (only production)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
EXPOSE 3001

# Default command
CMD ["node", "src/index.js"]
