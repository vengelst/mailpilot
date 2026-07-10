/**
 * @module db/prisma
 *
 * Singleton Prisma client instance backed by a PostgreSQL connection pool.
 * Uses the @prisma/adapter-pg driver adapter for native pg Pool support.
 *
 * In development the client is cached on `globalThis` so that Next.js
 * hot-reloads don't create a new connection pool on every module reload.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

// Cache slot on globalThis to survive HMR in development
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg(new Pool({ connectionString }));

/**
 * The shared Prisma client instance used across the entire server.
 * Reuses an existing instance from the global cache when available.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

// Persist the client in the global cache outside production to prevent
// connection pool exhaustion during Next.js hot-module reloads.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
