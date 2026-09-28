import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  consumeRateLimit: vi.fn(),
  createOtpChallenge: vi.fn(),
  sendOtp: vi.fn(),
}));

vi.mock("../config/db", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: vi.fn(), createFirebaseCustomToken: vi.fn() }));
vi.mock("../services/rateLimiter", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("../services/otpChallenge", () => ({
  createOtpChallenge: mocks.createOtpChallenge,
  consumeOtpChallenge: vi.fn(),
  decryptOtpPhone: vi.fn(),
  OtpCooldownError: class OtpCooldownError extends Error {},
}));
vi.mock("../services/sms", () => ({ createSmsProvider: () => ({ sendOtp: mocks.sendOtp }) }));

import authRouter from "./auth.route";

const app = express().use(express.json()).use("/auth", authRouter);

describe("customer auth regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mocks.createOtpChallenge.mockResolvedValue({ challengeId: "challenge", code: "123456", retryAfterSeconds: 60 });
  });

  it("returns identical request responses for existing and unknown phones", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "user-1", uid: "firebase-1", isActive: true });
    const existing = await request(app).post("/auth/otp/login/request").send({ phone: "9876543210" });
    mocks.findUnique.mockResolvedValueOnce(null);
    const unknown = await request(app).post("/auth/otp/login/request").send({ phone: "9123456789" });

    expect(existing.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(existing.body.message).toBe(unknown.body.message);
    expect(Object.keys(existing.body).sort()).toEqual(Object.keys(unknown.body).sort());
  });

  it.each(["/user/login-by-email", "/user/login-by-phone", "/user/register", "/user/update-password", "/password-reset"])(
    "keeps the legacy endpoint removed: %s",
    async (path) => {
      const response = await request(app).post("/auth" + path).send({ email: "person@example.com", phone: "9876543210" });
      expect(response.status).toBe(404);
    },
  );
});

