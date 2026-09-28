import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  userFindUnique: vi.fn(),
  verifyMfaProof: vi.fn(),
  send: vi.fn(),
  receive: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("../config/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("../services/adminMfa", () => ({ verifyMfaProof: mocks.verifyMfaProof }));
vi.mock("../services/Mail", () => ({ default: { send: mocks.send, receive: mocks.receive } }));
vi.mock("../services/rateLimiter", () => ({ consumeRateLimit: mocks.consumeRateLimit }));

import mailRouter from "./mail.route";

const app = express()
  .use(cookieParser())
  .use(express.json())
  .use("/mail", mailRouter);

const account = (role: "USER" | "COADMIN" | "ADMIN") => ({
  id: `${role.toLowerCase()}-1`,
  uid: `${role.toLowerCase()}-uid`,
  fullName: `${role} Account`,
  email: `${role.toLowerCase()}@example.com`,
  phone: "+919876543210",
  role,
  isActive: true,
});

describe("mail route access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "admin-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue(account("ADMIN"));
    mocks.verifyMfaProof.mockReturnValue(true);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mocks.send.mockResolvedValue(undefined);
    mocks.receive.mockResolvedValue([]);
  });

  it("requires authentication before sending mail", async () => {
    await request(app).post("/mail/send").send({
      to: "recipient@example.com",
      subject: "Service notice",
      text: "Message body",
    }).expect(401);
  });

  it("blocks customer accounts", async () => {
    mocks.userFindUnique.mockResolvedValue(account("USER"));
    await request(app).post("/mail/send").set("Authorization", "Bearer token").send({
      to: "recipient@example.com",
      subject: "Service notice",
      text: "Message body",
    }).expect(403);
  });

  it("requires a current MFA proof", async () => {
    mocks.verifyMfaProof.mockReturnValue(false);
    await request(app).post("/mail/send").set("Authorization", "Bearer token").send({
      to: "recipient@example.com",
      subject: "Service notice",
      text: "Message body",
    }).expect(403);
  });

  it("sends bounded mail for an MFA-verified administrator", async () => {
    const response = await request(app).post("/mail/send")
      .set("Authorization", "Bearer token")
      .set("Cookie", "__Host-admin_mfa=proof")
      .send({ to: "recipient@example.com", subject: "Service notice", text: "Message body" });

    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      ["recipient@example.com"],
      "Service notice",
      "Message body",
      "info",
      undefined,
    );
  });

  it("returns 429 without contacting SMTP when the send limit is exhausted", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 45 });
    const response = await request(app).post("/mail/send")
      .set("Authorization", "Bearer token")
      .set("Cookie", "__Host-admin_mfa=proof")
      .send({ to: "recipient@example.com", subject: "Service notice", text: "Message body" });

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("45");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
