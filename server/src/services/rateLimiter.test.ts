import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  RateLimitBucketRecord,
  RateLimitRepository,
} from "./rateLimiter";

class MemoryRateLimitRepository implements RateLimitRepository {
  private readonly buckets = new Map<string, RateLimitBucketRecord>();

  async increment(input: Omit<RateLimitBucketRecord, "count">) {
    await Promise.resolve();
    const bucketKey = `${input.scope}:${input.keyHash}:${input.windowStart.toISOString()}`;
    const current = this.buckets.get(bucketKey);
    const next = current
      ? { ...current, count: current.count + 1 }
      : { ...input, count: 1 };
    this.buckets.set(bucketKey, next);
    return next;
  }
}

describe("database rate limiter", () => {
  beforeEach(() => {
    process.env.OTP_PEPPER = "test-rate-limit-pepper-with-at-least-32-characters";
  });

  it("allows the first request and the exact configured limit", async () => {
    const repository = new MemoryRateLimitRepository();
    const now = () => new Date("2026-09-25T10:00:15.000Z");

    await expect(consumeRateLimit({ scope: "otp-phone", key: "+919876543210", limit: 2, windowSeconds: 60 }, { repository, now }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 45 });
    await expect(consumeRateLimit({ scope: "otp-phone", key: "+919876543210", limit: 2, windowSeconds: 60 }, { repository, now }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 45 });
  });

  it("blocks requests over the limit and reports the remaining window", async () => {
    const repository = new MemoryRateLimitRepository();
    const now = () => new Date("2026-09-25T10:00:45.000Z");
    const input = { scope: "otp-ip", key: "127.0.0.1", limit: 1, windowSeconds: 60 };

    await consumeRateLimit(input, { repository, now });
    await expect(consumeRateLimit(input, { repository, now }))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 15 });
  });

  it("resets after the fixed window expires", async () => {
    const repository = new MemoryRateLimitRepository();
    let current = new Date("2026-09-25T10:00:59.000Z");
    const input = { scope: "otp-ip", key: "127.0.0.1", limit: 1, windowSeconds: 60 };

    await consumeRateLimit(input, { repository, now: () => current });
    current = new Date("2026-09-25T10:01:00.000Z");
    await expect(consumeRateLimit(input, { repository, now: () => current }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 60 });
  });

  it("keeps scopes independent without storing the raw identifier", async () => {
    const repository = new MemoryRateLimitRepository();
    const now = () => new Date("2026-09-25T10:00:00.000Z");

    await consumeRateLimit({ scope: "signup-phone", key: "+919876543210", limit: 1, windowSeconds: 60 }, { repository, now });
    await expect(consumeRateLimit({ scope: "login-phone", key: "+919876543210", limit: 1, windowSeconds: 60 }, { repository, now }))
      .resolves.toMatchObject({ allowed: true });

    const serialized = JSON.stringify(repository);
    expect(serialized).not.toContain("+919876543210");
  });

  it("counts concurrent increments without losing requests", async () => {
    const repository = new MemoryRateLimitRepository();
    const now = () => new Date("2026-09-25T10:00:00.000Z");
    const input = { scope: "otp-ip", key: "127.0.0.1", limit: 3, windowSeconds: 60 };

    const results = await Promise.all(Array.from({ length: 5 }, () => consumeRateLimit(input, { repository, now })));
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(2);
  });
});
