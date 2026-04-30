# MailPilot production image — multi-stage build for Next.js + Prisma
# Stages: deps → builder → runner
# Runner image keeps prisma CLI + client so `prisma migrate deploy` works at runtime.

# ---------- 1. Dependencies ----------
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- 2. Builder ----------
FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- 3. Runner ----------
FROM node:22-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone Next.js output (server.js + minimal node_modules subset)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma CLI + full dependency tree needed for `prisma migrate deploy` at runtime.
# We copy full node_modules from deps so transitive Prisma CLI deps (e.g. `effect`)
# are present in the runner image.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Prisma artifacts needed by the app/migrations.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

# Healthcheck hits the Next.js server. Adjust path if you add a dedicated /api/health later.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/login || exit 1

CMD ["node", "server.js"]
