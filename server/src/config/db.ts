// prisma.ts
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger"; // Optional: Custom logger

// Attach PrismaClient to the global object in development to avoid hot reload issues
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Configure PrismaClient
const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// Connect to the database and log status
async function connectPrisma() {
  try {
    await prisma.$connect();
    if (process.env.NODE_ENV === "development") {
      console.info("[Prisma] Connected to PostgreSQL");
    }
  } catch (error) {
    const message = "[Prisma] Prisma connection error:";
    if (logger?.error) logger.error(message, error);
    else console.error(message, error);
    process.exit(1); // Optional: exit process on fatal error
  }
}

connectPrisma();

// Prevent creating multiple instances during hot reload in dev
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { prisma };
