import { beforeEach, describe, expect, it } from "vitest";
import {
  createOtpChallenge,
  consumeOtpChallenge,
  decryptOtpPhone,
  OtpChallengeRecord,
  OtpChallengeRepository,
  OtpCooldownError,
} from "./otpChallenge";

class MemoryOtpRepository implements OtpChallengeRepository {
  records: OtpChallengeRecord[] = [];

  async findLatestActive(phoneHash: string, purpose: OtpChallengeRecord["purpose"]) {
    return [...this.records].reverse().find((record) =>
      record.phoneHash === phoneHash && record.purpose === purpose && !record.consumedAt && !record.invalidatedAt,
    ) ?? null;
  }

  async invalidateActive(phoneHash: string, purpose: OtpChallengeRecord["purpose"], now: Date) {
    this.records.filter((record) => record.phoneHash === phoneHash && record.purpose === purpose && !record.consumedAt && !record.invalidatedAt)
      .forEach((record) => { record.invalidatedAt = now; });
  }

  async create(record: OtpChallengeRecord) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async recordFailedAttempt(id: string, now: Date) {
    const record = this.records.find((item) => item.id === id)!;
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) record.invalidatedAt = now;
  }

  async consumeIfActive(id: string, now: Date) {
    const record = this.records.find((item) => item.id === id)!;
    if (record.consumedAt || record.invalidatedAt || record.expiresAt <= now || record.attempts >= record.maxAttempts) return false;
    record.consumedAt = now;
    return true;
  }
}

describe("OTP challenge lifecycle", () => {
  beforeEach(() => {
    process.env.OTP_PEPPER = "test-otp-pepper-with-at-least-32-characters";
    process.env.OTP_PHONE_ENCRYPTION_KEY = "test-phone-key-with-at-least-32-characters";
  });

  it("stores only a digest and encrypted phone for a secure six-digit code", async () => {
    const repository = new MemoryOtpRepository();
    const created = await createOtpChallenge({ phone: "+919876543210", purpose: "SIGNUP_PHONE", requestIp: "127.0.0.1" }, {
      repository,
      now: () => new Date("2026-09-25T10:00:00.000Z"),
      randomInt: () => 42,
      randomId: () => "challenge-1",
    });

    expect(created.code).toBe("000042");
    expect(repository.records[0].codeDigest).not.toContain(created.code);
    expect(repository.records[0].encryptedPhone).not.toContain("9876543210");
    expect(decryptOtpPhone(repository.records[0].encryptedPhone)).toBe("+919876543210");
    expect(repository.records[0].expiresAt.toISOString()).toBe("2026-09-25T10:05:00.000Z");
    expect(created.retryAfterSeconds).toBe(60);
  });

  it("enforces cooldown then invalidates the previous challenge", async () => {
    const repository = new MemoryOtpRepository();
    let now = new Date("2026-09-25T10:00:00.000Z");
    const dependencies = { repository, now: () => now, randomInt: () => 123456, randomId: () => `challenge-${repository.records.length + 1}` };
    await createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, dependencies);
    now = new Date("2026-09-25T10:00:30.000Z");
    await expect(createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, dependencies)).rejects.toBeInstanceOf(OtpCooldownError);
    now = new Date("2026-09-25T10:01:01.000Z");
    await createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, dependencies);
    expect(repository.records[0].invalidatedAt).toEqual(now);
  });

  it("rejects expired challenges", async () => {
    const repository = new MemoryOtpRepository();
    let now = new Date("2026-09-25T10:00:00.000Z");
    const created = await createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, { repository, now: () => now, randomInt: () => 123456, randomId: () => "challenge-1" });
    now = new Date("2026-09-25T10:05:01.000Z");
    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code }, { repository, now: () => now })).resolves.toEqual({ valid: false, reason: "invalid" });
  });

  it("invalidates after five failed attempts", async () => {
    const repository = new MemoryOtpRepository();
    const now = new Date("2026-09-25T10:00:00.000Z");
    const created = await createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, { repository, now: () => now, randomInt: () => 123456, randomId: () => "challenge-1" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await consumeOtpChallenge({ challengeId: created.challengeId, code: "000000" }, { repository, now: () => now });
    }
    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code }, { repository, now: () => now })).resolves.toEqual({ valid: false, reason: "invalid" });
  });

  it("atomically consumes a correct challenge once", async () => {
    const repository = new MemoryOtpRepository();
    const now = new Date("2026-09-25T10:00:00.000Z");
    const created = await createOtpChallenge({ phone: "+919876543210", purpose: "SIGNUP_PHONE", requestIp: "127.0.0.1" }, { repository, now: () => now, randomInt: () => 654321, randomId: () => "challenge-1" });
    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code }, { repository, now: () => now })).resolves.toEqual({ valid: true, reason: "accepted" });
    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code }, { repository, now: () => now })).resolves.toEqual({ valid: false, reason: "invalid" });
  });

  it("rejects a valid code when the phone or purpose does not match", async () => {
    const repository = new MemoryOtpRepository();
    const now = new Date("2026-09-25T10:00:00.000Z");
    const created = await createOtpChallenge({ phone: "+919876543210", purpose: "LOGIN_PHONE", requestIp: "127.0.0.1" }, { repository, now: () => now, randomInt: () => 654321, randomId: () => "challenge-1" });

    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code, phone: "+919123456789", purpose: "LOGIN_PHONE" }, { repository, now: () => now }))
      .resolves.toEqual({ valid: false, reason: "invalid" });
    await expect(consumeOtpChallenge({ challengeId: created.challengeId, code: created.code, phone: "+919876543210", purpose: "SIGNUP_PHONE" }, { repository, now: () => now }))
      .resolves.toEqual({ valid: false, reason: "invalid" });
  });});

