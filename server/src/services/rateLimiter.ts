import { createHmac } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db";

export interface RateLimitBucketRecord {
  scope: string;
  keyHash: string;
  windowStart: Date;
  count: number;
  expiresAt: Date;
}

export interface RateLimitRepository {
  increment(input: Omit<RateLimitBucketRecord, "count">): Promise<RateLimitBucketRecord>;
}

const getPepper = (): string => {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("OTP_PEPPER must contain at least 32 characters");
  }
  return pepper;
};

const hashKey = (scope: string, key: string): string =>
  createHmac("sha256", getPepper()).update(`${scope}:${key}`).digest("hex");

const prismaRepository: RateLimitRepository = {
  async increment(input) {
    const bucket = await prisma.rateLimitBucket.upsert({
      where: {
        scope_keyHash_windowStart: {
          scope: input.scope,
          keyHash: input.keyHash,
          windowStart: input.windowStart,
        },
      },
      create: input,
      update: { count: { increment: 1 } },
    });

    return bucket;
  },
};

interface Dependencies {
  repository: RateLimitRepository;
  now: () => Date;
}

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  repository: prismaRepository,
  now: () => new Date(),
  ...overrides,
});

const incrementWithConflictRetry = async (
  repository: RateLimitRepository,
  input: Omit<RateLimitBucketRecord, "count">,
): Promise<RateLimitBucketRecord> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await repository.increment(input);
    } catch (error) {
      const isUniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueConflict || attempt === 2) throw error;
    }
  }

  throw new Error("Unable to consume rate limit");
};

export const consumeRateLimit = async (
  input: { scope: string; key: string; limit: number; windowSeconds: number },
  overrides: Partial<Dependencies> = {},
): Promise<{ allowed: boolean; retryAfterSeconds: number }> => {
  if (!input.scope || !input.key || input.limit < 1 || input.windowSeconds < 1) {
    throw new Error("Invalid rate-limit configuration");
  }

  const deps = dependencies(overrides);
  const now = deps.now();
  const windowMilliseconds = input.windowSeconds * 1_000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds);
  const expiresAt = new Date(windowStart.getTime() + windowMilliseconds);
  const bucket = await incrementWithConflictRetry(deps.repository, {
    scope: input.scope,
    keyHash: hashKey(input.scope, input.key),
    windowStart,
    expiresAt,
  });

  return {
    allowed: bucket.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
  };
};
