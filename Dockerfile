# --- Build client ---
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Build server ---
FROM node:22-slim AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# --- Runtime ---
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV CLIENT_DIST=/app/client-dist
ENV PORT=8080

COPY --from=server-build /app/server/package*.json ./
# better-sqlite3 ships prebuilt binaries for most platforms; build tools are a fallback
# for architectures without one (e.g. some arm64 hosts), removed again to keep the image slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm install --omit=dev \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ./client-dist

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
