# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .

# Generate Prisma clients before building
RUN npm run db:generate

# VITE_API_URL can be injected at build time for separated front-end/back-end
# deployments.  Leave unset (or set to "") when the Express server serves the
# front-end on the same origin (the typical cloud deployment).
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artefacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/prisma ./prisma

# Expose the API/app port
EXPOSE 8787

# Default environment — override with real values at runtime
ENV NODE_ENV=production
ENV PORT=8787
# Point at your Ollama instance: e.g. http://your-ollama-host:11434
ENV OLLAMA_BASE_URL=http://localhost:11434
ENV OLLAMA_MODEL=llama3.2
# Set to your public HTTPS URL, e.g. https://ultron.example.com
ENV APP_ORIGIN=
# SQLite by default; use postgresql://... for a hosted DB
ENV DATABASE_URL=file:./data/ultron.db
# Set a long random secret for the credential vault (strongly recommended — the
# server will log a warning and fall back to a machine-derived key if unset,
# but cloud deployments should always set this explicitly).
ENV CREDENTIAL_ENCRYPTION_KEY=

# Persist SQLite data across container restarts
VOLUME ["/app/data"]

CMD ["node", "dist-server/index.js"]
