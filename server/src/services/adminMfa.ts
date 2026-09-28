import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { authenticator } from "otplib";
import { prisma } from "../config/db";

const signingSecret = (): string => {
  const value = process.env.ADMIN_MFA_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error("ADMIN_MFA_SIGNING_SECRET must contain at least 32 characters");
  return value;
};
const encryptionKey = (): Buffer => {
  const value = process.env.TOTP_ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new Error("TOTP_ENCRYPTION_KEY must contain at least 32 characters");
  return createHash("sha256").update(value).digest();
};
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const encrypt = (value: string): string => {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
};
const decrypt = (value: string): string => {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
};

export const createMfaProof = (uid: string, now = Date.now()): string => {
  const payload = Buffer.from(JSON.stringify({ uid, purpose: "admin-mfa", exp: now + 28_800_000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", signingSecret()).update(payload).digest("base64url")}`;
};
export const verifyMfaProof = (proof: string, uid: string, now = Date.now()): boolean => {
  try {
    const [payload, signature] = proof.split("."); const expected = createHmac("sha256", signingSecret()).update(payload).digest(); const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; purpose: string; exp: number };
    return decoded.uid === uid && decoded.purpose === "admin-mfa" && decoded.exp > now;
  } catch { return false; }
};
export const createEnrollment = async (userId: string) => {
  const secret = authenticator.generateSecret(); const encryptedTotpSecret = encrypt(secret);
  await prisma.adminSecurity.upsert({ where: { userId }, update: { encryptedTotpSecret, enabledAt: null, recoveryCodeHashes: [] }, create: { userId, encryptedTotpSecret, recoveryCodeHashes: [] } });
  return { secret, otpauth: authenticator.keyuri(userId, "LegalDhara", secret) };
};
export const confirmEnrollment = async (userId: string, code: string) => {
  const security = await prisma.adminSecurity.findUniqueOrThrow({ where: { userId } });
  if (!authenticator.check(code, decrypt(security.encryptedTotpSecret))) throw new Error("Invalid verification code");
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(12).toString("base64url"));
  await prisma.adminSecurity.update({ where: { userId }, data: { enabledAt: new Date(), recoveryCodeHashes: recoveryCodes.map(hash) } }); return recoveryCodes;
};
export const acceptMfaTimeStep = async (userId: string, now = Date.now()): Promise<boolean> => {
  const timeStep = BigInt(Math.floor(now / 30_000));
  const result = await prisma.adminSecurity.updateMany({
    where: { userId, OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: timeStep } }] },
    data: { lastAcceptedTimeStep: timeStep },
  });
  return result.count === 1;
};
export const verifyMfa = async (userId: string, code: string): Promise<boolean> => {
  const security = await prisma.adminSecurity.findUnique({ where: { userId } });
  if (!security?.enabledAt || !authenticator.check(code, decrypt(security.encryptedTotpSecret))) return false;
  return acceptMfaTimeStep(userId);
};
export const consumeRecoveryCode = async (userId: string, code: string): Promise<boolean> => {
  const security = await prisma.adminSecurity.findUnique({ where: { userId } }); const codeHash = hash(code);
  if (!security?.recoveryCodeHashes.includes(codeHash)) return false;
  await prisma.adminSecurity.update({ where: { userId }, data: { recoveryCodeHashes: security.recoveryCodeHashes.filter((item) => item !== codeHash) } }); return true;
};
