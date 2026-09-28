import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../config/db";
import { createFirebaseCustomToken } from "../config/firebase";
import { createOtpChallenge, consumeOtpChallenge } from "../services/otpChallenge";
import { consumeRateLimit } from "../services/rateLimiter";
import { createSmsProvider } from "../services/sms";
import { normalizeIndianPhone, phoneLoginRequestSchema, phoneLoginVerifySchema } from "../zodSchema/customerAuth.schema";

const genericRequestMessage = "If eligible, verification will continue.";
const invalidCodeMessage = "Verification code is invalid or expired.";
const smsProvider = createSmsProvider();
const requestIp = (request: Request): string => request.ip || request.socket.remoteAddress || "unknown";

export const requestPhoneLoginOtp = async (request: Request, response: Response): Promise<Response> => {
  const parsed = phoneLoginRequestSchema.safeParse(request.body);
  const phone = parsed.success ? normalizeIndianPhone(parsed.data.phone) : null;
  if (!phone) return response.status(400).json({ success: false, error: "Invalid request" });

  const ip = requestIp(request);
  const limits = await Promise.all([
    consumeRateLimit({ scope: "login-phone", key: phone, limit: 5, windowSeconds: 3_600 }),
    consumeRateLimit({ scope: "login-ip", key: ip, limit: 10, windowSeconds: 3_600 }),
  ]);
  if (limits.some((result) => !result.allowed)) {
    return response.status(202).json({
      success: true,
      message: genericRequestMessage,
      challengeId: randomUUID(),
      retryAfterSeconds: 60,
    });
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, uid: true, isActive: true },
  });
  if (!user?.isActive || !user.uid) {
    return response.status(202).json({
      success: true,
      message: genericRequestMessage,
      challengeId: randomUUID(),
      retryAfterSeconds: 60,
    });
  }

  let challengeId: string = randomUUID();
  try {
    const challenge = await createOtpChallenge({ phone, purpose: "LOGIN_PHONE", requestIp: ip });
    challengeId = challenge.challengeId;
    await smsProvider.sendOtp({ phone, code: challenge.code, expiresInSeconds: 300 });
  } catch {}

  return response.status(202).json({
    success: true,
    message: genericRequestMessage,
    challengeId,
    retryAfterSeconds: 60,
  });
};

export const verifyPhoneLoginOtp = async (request: Request, response: Response): Promise<Response> => {
  const parsed = phoneLoginVerifySchema.safeParse(request.body);
  const phone = parsed.success ? normalizeIndianPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) {
    return response.status(400).json({ success: false, error: invalidCodeMessage });
  }

  const ipLimit = await consumeRateLimit({ scope: "login-verify-ip", key: requestIp(request), limit: 20, windowSeconds: 3_600 });
  if (!ipLimit.allowed) return response.status(400).json({ success: false, error: invalidCodeMessage });

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, uid: true, isActive: true },
  });
  if (!user?.isActive || !user.uid) {
    return response.status(400).json({ success: false, error: invalidCodeMessage });
  }

  const challenge = await consumeOtpChallenge({
    challengeId: parsed.data.challengeId,
    code: parsed.data.code,
    phone,
    purpose: "LOGIN_PHONE",
  });
  if (!challenge.valid) return response.status(400).json({ success: false, error: invalidCodeMessage });

  try {
    const customToken = await createFirebaseCustomToken(user.uid, { loginMethod: "phone_otp" });
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    return response.status(200).json({ success: true, customToken });
  } catch {
    return response.status(503).json({ success: false, error: "Authentication temporarily unavailable" });
  }
};





