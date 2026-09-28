import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../config/db";
import { FirebaseIdentityRequest } from "../types/custom";
import { createOtpChallenge, consumeOtpChallenge, decryptOtpPhone, OtpCooldownError } from "../services/otpChallenge";
import { consumeRateLimit } from "../services/rateLimiter";
import { createSmsProvider } from "../services/sms";
import {
  normalizeIndianPhone,
  signupCompleteSchema,
  signupPhoneRequestSchema,
  signupPhoneVerifySchema,
} from "../zodSchema/customerAuth.schema";

const genericRequestMessage = "If eligible, verification will continue.";
const invalidCodeMessage = "Verification code is invalid or expired.";
const signupFailureMessage = "Unable to complete signup.";
const smsProvider = createSmsProvider();

const identityFrom = (request: Request) => (request as FirebaseIdentityRequest).firebaseIdentity;

const requireVerifiedIdentity = (request: Request, response: Response) => {
  const identity = identityFrom(request);
  if (!identity) {
    response.status(401).json({ success: false, error: "Authentication required" });
    return null;
  }
  if (!identity.email || !identity.emailVerified) {
    response.status(403).json({ success: false, error: "Verified email required" });
    return null;
  }
  return identity;
};

const requestIp = (request: Request): string => request.ip || request.socket.remoteAddress || "unknown";

export const requestSignupPhoneOtp = async (request: Request, response: Response): Promise<Response | void> => {
  const identity = requireVerifiedIdentity(request, response);
  if (!identity) return;
  const parsed = signupPhoneRequestSchema.safeParse(request.body);
  const phone = parsed.success ? normalizeIndianPhone(parsed.data.phone) : null;
  if (!phone) return response.status(400).json({ success: false, error: "Invalid request" });

  const ip = requestIp(request);
  const limits = await Promise.all([
    consumeRateLimit({ scope: "signup-phone", key: phone, limit: 5, windowSeconds: 3_600 }),
    consumeRateLimit({ scope: "signup-ip", key: ip, limit: 10, windowSeconds: 3_600 }),
    consumeRateLimit({ scope: "signup-uid", key: identity.uid, limit: 5, windowSeconds: 3_600 }),
  ]);
  const blocked = limits.find((result) => !result.allowed);
  if (blocked) {
    response.setHeader("Retry-After", blocked.retryAfterSeconds);
    return response.status(202).json({
      success: true,
      message: genericRequestMessage,
      challengeId: randomUUID(),
      retryAfterSeconds: 60,
    });
  }

  let challengeId: string = randomUUID();
  try {
    const challenge = await createOtpChallenge({ phone, purpose: "SIGNUP_PHONE", requestIp: ip });
    challengeId = challenge.challengeId;
    await smsProvider.sendOtp({ phone, code: challenge.code, expiresInSeconds: 300 });
  } catch (error) {
    if (!(error instanceof OtpCooldownError)) {
      console.error("[SMS] OTP delivery failed:", error instanceof Error ? error.message : "Unknown provider error");
      return response.status(503).json({ success: false, message: genericRequestMessage });
    }
  }

  return response.status(202).json({
    success: true,
    message: genericRequestMessage,
    challengeId,
    retryAfterSeconds: 60,
  });
};

export const verifySignupPhoneOtp = async (request: Request, response: Response): Promise<Response | void> => {
  const identity = requireVerifiedIdentity(request, response);
  if (!identity) return;
  const parsed = signupPhoneVerifySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: invalidCodeMessage });

  const ipLimit = await consumeRateLimit({ scope: "signup-verify-ip", key: requestIp(request), limit: 20, windowSeconds: 3_600 });
  if (!ipLimit.allowed) return response.status(429).json({ success: false, error: invalidCodeMessage });

  const result = await consumeOtpChallenge(parsed.data);
  if (!result.valid) return response.status(400).json({ success: false, error: invalidCodeMessage });

  const now = new Date();
  const updated = await prisma.otpChallenge.updateMany({
    where: {
      id: parsed.data.challengeId,
      purpose: "SIGNUP_PHONE",
      consumedAt: { not: null },
      invalidatedAt: null,
      verifiedUid: null,
    },
    data: { verifiedUid: identity.uid, verifiedAt: now },
  });
  if (updated.count !== 1) return response.status(400).json({ success: false, error: invalidCodeMessage });

  return response.status(200).json({ success: true, challengeId: parsed.data.challengeId });
};

export const completeSignup = async (request: Request, response: Response): Promise<Response | void> => {
  const identity = requireVerifiedIdentity(request, response);
  if (!identity) return;
  const parsed = signupCompleteSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid request" });

  const ip = requestIp(request);
  const limits = await Promise.all([
    consumeRateLimit({ scope: "signup-complete-uid", key: identity.uid, limit: 5, windowSeconds: 3_600 }),
    consumeRateLimit({ scope: "signup-complete-ip", key: ip, limit: 10, windowSeconds: 3_600 }),
  ]);
  if (limits.some((result) => !result.allowed)) {
    return response.status(429).json({ success: false, error: signupFailureMessage });
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      id: parsed.data.challengeId,
      purpose: "SIGNUP_PHONE",
      verifiedUid: identity.uid,
      verifiedAt: { gte: new Date(Date.now() - 15 * 60_000) },
      consumedAt: { not: null },
      invalidatedAt: null,
    },
    select: { id: true, encryptedPhone: true, verifiedUid: true },
  });
  if (!challenge) return response.status(400).json({ success: false, error: signupFailureMessage });

  const phone = decryptOtpPhone(challenge.encryptedPhone);
  const email = identity.email!.toLowerCase();
  const collision = await prisma.user.findFirst({
    where: { OR: [{ uid: identity.uid }, { email }, { phone }] },
    select: { id: true },
  });
  if (collision) return response.status(409).json({ success: false, error: signupFailureMessage });

  const now = new Date();
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.otpChallenge.updateMany({
        where: { id: challenge.id, verifiedUid: identity.uid, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      if (claimed.count !== 1) throw new Error("Signup challenge already used");
      return transaction.user.create({
        data: {
          uid: identity.uid,
          fullName: parsed.data.fullName,
          email,
          phone,
          dob: parsed.data.dob,
          gender: parsed.data.gender,
          city: parsed.data.city,
          role: "USER",
          isActive: true,
          termsAccepted: true,
          termsAcceptedAt: now,
          emailVerified: true,
          phoneVerifiedAt: now,
        },
      });
    });
    return response.status(201).json({ success: true, userId: user.id });
  } catch {
    return response.status(409).json({ success: false, error: signupFailureMessage });
  }
};





