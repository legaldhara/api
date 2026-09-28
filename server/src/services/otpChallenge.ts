import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { prisma } from "../config/db";

export type OtpPurpose = "SIGNUP_PHONE" | "LOGIN_PHONE";
export interface OtpChallengeRecord { id: string; purpose: OtpPurpose; phoneHash: string; encryptedPhone: string; codeDigest: string; expiresAt: Date; resendAt: Date; attempts: number; maxAttempts: number; consumedAt: Date | null; invalidatedAt: Date | null; requestIpHash: string; createdAt: Date; updatedAt: Date; }
export interface OtpChallengeRepository {
  findLatestActive(phoneHash: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | null>;
  invalidateActive(phoneHash: string, purpose: OtpPurpose, now: Date): Promise<void>;
  create(record: OtpChallengeRecord): Promise<OtpChallengeRecord>;
  findById(id: string): Promise<OtpChallengeRecord | null>;
  recordFailedAttempt(id: string, now: Date): Promise<void>;
  consumeIfActive(id: string, now: Date): Promise<boolean>;
}
const secret = (name: "OTP_PEPPER" | "OTP_PHONE_ENCRYPTION_KEY"): string => { const value = process.env[name]; if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters`); return value; };
const digest = (value: string): string => createHmac("sha256", secret("OTP_PEPPER")).update(value).digest("hex");
const encryptionKey = (): Buffer => createHmac("sha256", secret("OTP_PHONE_ENCRYPTION_KEY")).update("legaldhara-otp-phone").digest();
const encryptPhone = (phone: string): string => { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join("."); };
export const decryptOtpPhone = (value: string): string => { const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url")); const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"); };

const prismaRepository: OtpChallengeRepository = {
  async findLatestActive(phoneHash, purpose) { return prisma.otpChallenge.findFirst({ where: { phoneHash, purpose, consumedAt: null, invalidatedAt: null }, orderBy: { createdAt: "desc" } }); },
  async invalidateActive(phoneHash, purpose, now) { await prisma.otpChallenge.updateMany({ where: { phoneHash, purpose, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } }); },
  async create(record) { return prisma.otpChallenge.create({ data: record }); },
  async findById(id) { return prisma.otpChallenge.findUnique({ where: { id } }); },
  async recordFailedAttempt(id, now) { const updated = await prisma.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } }); if (updated.attempts >= updated.maxAttempts) await prisma.otpChallenge.updateMany({ where: { id, invalidatedAt: null }, data: { invalidatedAt: now } }); },
  async consumeIfActive(id, now) { const result = await prisma.otpChallenge.updateMany({ where: { id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { consumedAt: now } }); return result.count === 1; },
};
interface Dependencies { repository: OtpChallengeRepository; now: () => Date; randomInt: (minimum: number, maximum: number) => number; randomId: () => string; }
const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({ repository: prismaRepository, now: () => new Date(), randomInt, randomId: randomUUID, ...overrides });
export class OtpCooldownError extends Error { constructor(public readonly retryAfterSeconds: number) { super("OTP resend cooldown is active"); } }

export const createOtpChallenge = async (input: { phone: string; purpose: OtpPurpose; requestIp: string }, overrides: Partial<Dependencies> = {}): Promise<{ challengeId: string; code: string; retryAfterSeconds: number }> => {
  const deps = dependencies(overrides); const now = deps.now(); const phoneHash = digest(`phone:${input.phone}`); const current = await deps.repository.findLatestActive(phoneHash, input.purpose);
  if (current?.resendAt && current.resendAt > now) throw new OtpCooldownError(Math.ceil((current.resendAt.getTime() - now.getTime()) / 1000));
  await deps.repository.invalidateActive(phoneHash, input.purpose, now);
  const id = deps.randomId(); const code = deps.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await deps.repository.create({ id, purpose: input.purpose, phoneHash, encryptedPhone: encryptPhone(input.phone), codeDigest: digest(`${id}:${code}`), expiresAt: new Date(now.getTime() + 300_000), resendAt: new Date(now.getTime() + 60_000), attempts: 0, maxAttempts: 5, consumedAt: null, invalidatedAt: null, requestIpHash: digest(`ip:${input.requestIp}`), createdAt: now, updatedAt: now });
  return { challengeId: id, code, retryAfterSeconds: 60 };
};
export const consumeOtpChallenge = async (input: { challengeId: string; code: string; phone?: string; purpose?: OtpPurpose }, overrides: Partial<Pick<Dependencies, "repository" | "now">> = {}): Promise<{ valid: boolean; reason: "accepted" | "invalid" }> => {
  const deps = dependencies(overrides); const now = deps.now(); const challenge = await deps.repository.findById(input.challengeId);
  if (!challenge || challenge.consumedAt || challenge.invalidatedAt || challenge.expiresAt <= now || challenge.attempts >= challenge.maxAttempts) return { valid: false, reason: "invalid" };
  if (input.purpose && challenge.purpose !== input.purpose) return { valid: false, reason: "invalid" };
  if (input.phone && challenge.phoneHash !== digest("phone:" + input.phone)) return { valid: false, reason: "invalid" };
  const expected = Buffer.from(challenge.codeDigest, "hex"); const supplied = Buffer.from(digest(`${challenge.id}:${input.code}`), "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { await deps.repository.recordFailedAttempt(challenge.id, now); return { valid: false, reason: "invalid" }; }
  return await deps.repository.consumeIfActive(challenge.id, now) ? { valid: true, reason: "accepted" } : { valid: false, reason: "invalid" };
};

