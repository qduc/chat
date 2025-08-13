## Frontend Dockerfile (multi-stage)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copy only necessary build artifacts
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/package*.json ./
# Prune dev deps
RUN npm prune --omit=dev
EXPOSE 3000
CMD ["npm", "run", "start"]
