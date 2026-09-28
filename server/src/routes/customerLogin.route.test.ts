import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOtpChallenge: vi.fn(),
  consumeOtpChallenge: vi.fn(),
  consumeRateLimit: vi.fn(),
  sendOtp: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  createCustomToken: vi.fn(),
}));

vi.mock("../services/otpChallenge", () => ({
  createOtpChallenge: mocks.createOtpChallenge,
  consumeOtpChallenge: mocks.consumeOtpChallenge,
  decryptOtpPhone: vi.fn(),
  OtpCooldownError: class OtpCooldownError extends Error {},
}));
vi.mock("../services/rateLimiter", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("../services/sms", () => ({ createSmsProvider: () => ({ sendOtp: mocks.sendOtp }) }));
vi.mock("../config/firebase", () => ({
  createFirebaseCustomToken: mocks.createCustomToken,
  verifyFirebaseIdToken: vi.fn(),
}));
vi.mock("../config/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
  },
}));

import authRouter from "./auth.route";

const app = express().use(express.json()).use("/auth", authRouter);
const genericMessage = "If eligible, verification will continue.";
const challengeId = "11111111-1111-4111-8111-111111111111";

describe("customer phone login routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mocks.userFindUnique.mockResolvedValue({ id: "db-user-1", uid: "firebase-user-1", isActive: true });
    mocks.createOtpChallenge.mockResolvedValue({ challengeId, code: "123456", retryAfterSeconds: 60 });
    mocks.consumeOtpChallenge.mockResolvedValue({ valid: true, reason: "accepted" });
    mocks.createCustomToken.mockResolvedValue("firebase-custom-token");
    mocks.userUpdate.mockResolvedValue({ id: "db-user-1" });
  });

  it("returns identical request responses for known and unknown phones", async () => {
    const known = await request(app).post("/auth/otp/login/request").send({ phone: "9876543210" });
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const unknown = await request(app).post("/auth/otp/login/request").send({ phone: "9123456789" });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toMatchObject({ success: true, message: genericMessage, challengeId, retryAfterSeconds: 60 });
    expect(unknown.body).toMatchObject({ success: true, message: genericMessage, retryAfterSeconds: 60 });
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());
  });

  it("sends an OTP only for an active linked user", async () => {
    await request(app).post("/auth/otp/login/request").send({ phone: "98765 43210" });
    expect(mocks.createOtpChallenge).toHaveBeenCalledWith(expect.objectContaining({ phone: "+919876543210", purpose: "LOGIN_PHONE" }));
    expect(mocks.sendOtp).toHaveBeenCalledWith({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 });

    mocks.userFindUnique.mockResolvedValueOnce({ id: "db-user-2", uid: "firebase-user-2", isActive: false });
    await request(app).post("/auth/otp/login/request").send({ phone: "9123456789" });
    expect(mocks.sendOtp).toHaveBeenCalledTimes(1);
  });

  it("silently suppresses delivery when request limits are exceeded", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 120 });
    const response = await request(app).post("/auth/otp/login/request").send({ phone: "9876543210" });
    expect(response.status).toBe(202);
    expect(response.body.message).toBe(genericMessage);
    expect(mocks.sendOtp).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired codes generically", async () => {
    mocks.consumeOtpChallenge.mockResolvedValue({ valid: false, reason: "invalid" });
    const response = await request(app).post("/auth/otp/login/verify")
      .send({ phone: "9876543210", challengeId, code: "000000" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: "Verification code is invalid or expired." });
  });

  it("rejects users that are no longer active", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "db-user-1", uid: "firebase-user-1", isActive: false });
    const response = await request(app).post("/auth/otp/login/verify")
      .send({ phone: "9876543210", challengeId, code: "123456" });
    expect(response.status).toBe(400);
    expect(mocks.consumeOtpChallenge).not.toHaveBeenCalled();
  });

  it("binds the challenge to the phone and returns a Firebase custom token", async () => {
    const response = await request(app).post("/auth/otp/login/verify")
      .send({ phone: "9876543210", challengeId, code: "123456" });

    expect(response.status).toBe(200);
    expect(mocks.consumeOtpChallenge).toHaveBeenCalledWith({
      challengeId,
      code: "123456",
      phone: "+919876543210",
      purpose: "LOGIN_PHONE",
    });
    expect(mocks.createCustomToken).toHaveBeenCalledWith("firebase-user-1", { loginMethod: "phone_otp" });
    expect(response.body).toEqual({ success: true, customToken: "firebase-custom-token" });
  });
});



