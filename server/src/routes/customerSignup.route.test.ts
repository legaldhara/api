import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  createOtpChallenge: vi.fn(),
  consumeOtpChallenge: vi.fn(),
  decryptOtpPhone: vi.fn(),
  consumeRateLimit: vi.fn(),
  sendOtp: vi.fn(),
  challengeUpdateMany: vi.fn(),
  challengeFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  transactionChallengeUpdateMany: vi.fn(),
  transactionUserCreate: vi.fn(),
}));

vi.mock("../config/firebase", () => ({
  verifyFirebaseIdToken: mocks.verifyIdToken,
}));

vi.mock("../services/otpChallenge", () => ({
  createOtpChallenge: mocks.createOtpChallenge,
  consumeOtpChallenge: mocks.consumeOtpChallenge,
  decryptOtpPhone: mocks.decryptOtpPhone,
  OtpCooldownError: class OtpCooldownError extends Error {},
}));

vi.mock("../services/rateLimiter", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));

vi.mock("../services/sms", () => ({
  createSmsProvider: () => ({ sendOtp: mocks.sendOtp }),
}));

vi.mock("../config/db", () => {
  const transactionClient = {
    otpChallenge: { updateMany: mocks.transactionChallengeUpdateMany },
    user: { create: mocks.transactionUserCreate },
  };
  return {
    prisma: {
      otpChallenge: {
        updateMany: mocks.challengeUpdateMany,
        findFirst: mocks.challengeFindFirst,
      },
      user: { findFirst: mocks.userFindFirst },
      $transaction: vi.fn((callback: (client: typeof transactionClient) => unknown) => callback(transactionClient)),
    },
  };
});

import authRouter from "./auth.route";

const app = express().use(express.json()).use("/auth", authRouter);
const verifiedIdentity = { uid: "firebase-user-1", email: "new@example.com", email_verified: true };

describe("customer signup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockResolvedValue(verifiedIdentity);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mocks.createOtpChallenge.mockResolvedValue({ challengeId: "11111111-1111-4111-8111-111111111111", code: "123456", retryAfterSeconds: 60 });
    mocks.consumeOtpChallenge.mockResolvedValue({ valid: true, reason: "accepted" });
    mocks.challengeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.challengeFindFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      encryptedPhone: "encrypted-phone",
      verifiedUid: verifiedIdentity.uid,
    });
    mocks.decryptOtpPhone.mockReturnValue("+919876543210");
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.transactionChallengeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transactionUserCreate.mockResolvedValue({ id: "db-user-1" });
  });

  it("requires a Firebase bearer token", async () => {
    const response = await request(app).post("/auth/signup/phone/request").send({ phone: "9876543210" });
    expect(response.status).toBe(401);
  });

  it("requires a freshly verified Firebase email", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "firebase-user-1", email: "new@example.com", email_verified: false });
    const response = await request(app).post("/auth/signup/phone/request")
      .set("Authorization", "Bearer firebase-token")
      .send({ phone: "9876543210" });
    expect(response.status).toBe(403);
  });

  it("normalizes Indian numbers and returns generic request copy", async () => {
    const response = await request(app).post("/auth/signup/phone/request")
      .set("Authorization", "Bearer firebase-token")
      .send({ phone: "98765 43210" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ success: true, message: "If eligible, verification will continue.", challengeId: "11111111-1111-4111-8111-111111111111", retryAfterSeconds: 60 });
    expect(mocks.createOtpChallenge).toHaveBeenCalledWith(expect.objectContaining({ phone: "+919876543210", purpose: "SIGNUP_PHONE" }));
    expect(mocks.sendOtp).toHaveBeenCalledWith({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 });
  });

  it("logs a secret-free SMS provider diagnostic when delivery fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sendOtp.mockRejectedValue(new Error("SMS delivery failed with status 401"));

    const response = await request(app).post("/auth/signup/phone/request")
      .set("Authorization", "Bearer firebase-token")
      .send({ phone: "+919876543210" });

    expect(response.status).toBe(503);
    expect(consoleError).toHaveBeenCalledWith("[SMS] OTP delivery failed:", "SMS delivery failed with status 401");
    consoleError.mockRestore();
  });

  it("returns a generic rejection when request limits are exceeded", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });
    const response = await request(app).post("/auth/signup/phone/request")
      .set("Authorization", "Bearer firebase-token")
      .send({ phone: "9876543210" });
    expect(response.status).toBe(202);
    expect(response.body.message).toBe("If eligible, verification will continue.");
  });

  it("rejects invalid OTPs without account details", async () => {
    mocks.consumeOtpChallenge.mockResolvedValue({ valid: false, reason: "invalid" });
    const response = await request(app).post("/auth/signup/phone/verify")
      .set("Authorization", "Bearer firebase-token")
      .send({ challengeId: "11111111-1111-4111-8111-111111111111", code: "000000" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: "Verification code is invalid or expired." });
  });

  it("binds an accepted OTP challenge to the Firebase UID", async () => {
    const response = await request(app).post("/auth/signup/phone/verify")
      .set("Authorization", "Bearer firebase-token")
      .send({ challengeId: "11111111-1111-4111-8111-111111111111", code: "123456" });
    expect(response.status).toBe(200);
    expect(mocks.challengeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ verifiedUid: null }),
      data: expect.objectContaining({ verifiedUid: verifiedIdentity.uid }),
    }));
  });

  it("requires accepted terms before account activation", async () => {
    const response = await request(app).post("/auth/signup/complete")
      .set("Authorization", "Bearer firebase-token")
      .send({ challengeId: "11111111-1111-4111-8111-111111111111", fullName: "New User", termsAccepted: false });
    expect(response.status).toBe(400);
  });

  it("rejects UID, email, or phone collisions generically", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "existing-user" });
    const response = await request(app).post("/auth/signup/complete")
      .set("Authorization", "Bearer firebase-token")
      .send({ challengeId: "11111111-1111-4111-8111-111111111111", fullName: "New User", termsAccepted: true });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ success: false, error: "Unable to complete signup." });
  });

  it("creates an active USER only after both verifications", async () => {
    const response = await request(app).post("/auth/signup/complete")
      .set("Authorization", "Bearer firebase-token")
      .send({
        challengeId: "11111111-1111-4111-8111-111111111111",
        fullName: "New User",
        termsAccepted: true,
        city: "Delhi",
      });

    expect(response.status).toBe(201);
    expect(mocks.transactionUserCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      uid: verifiedIdentity.uid,
      email: verifiedIdentity.email,
      phone: "+919876543210",
      role: "USER",
      isActive: true,
      emailVerified: true,
      termsAccepted: true,
      phoneVerifiedAt: expect.any(Date),
    }) });
  });
});



