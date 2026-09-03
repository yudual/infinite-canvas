# Stage 1: Build Frontend (web)
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app/web
COPY web/package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --legacy-peer-deps
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN npm run build

# Stage 2: Build Backend (server)
FROM node:22-bookworm-slim AS server-builder
WORKDIR /app/server
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --legacy-peer-deps
COPY server ./
RUN npm run build

# Stage 3: Production Runtime
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install native compilation dependencies for better-sqlite3 and curl for health check
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

# Install server production dependencies
WORKDIR /app/server
COPY server/package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install --omit=dev --legacy-peer-deps

# Copy compiled backend
COPY --from=server-builder /app/server/dist ./dist

# Copy compiled frontend
WORKDIR /app
COPY --from=web-builder /app/web/dist ./web/dist

# Setup data persistence directory
RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/canvas.db
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server/dist/index.js"]
