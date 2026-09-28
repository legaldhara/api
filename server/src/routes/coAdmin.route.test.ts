import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  userFindUnique: vi.fn(),
  verifyMfaProof: vi.fn(),
  invite: vi.fn((_request: unknown, response: any) => response.status(201).json({ success: true })),
  list: vi.fn((_request: unknown, response: any) => response.json({ success: true, data: [] })),
  resend: vi.fn((_request: unknown, response: any) => response.json({ success: true })),
  status: vi.fn((_request: unknown, response: any) => response.json({ success: true })),
}));

vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("../config/db", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("../services/adminMfa", () => ({ verifyMfaProof: mocks.verifyMfaProof }));
vi.mock("../controller/coAdmin.controller", () => ({
  inviteCoAdminController: mocks.invite,
  listCoAdminsController: mocks.list,
  resendCoAdminInvitationController: mocks.resend,
  setCoAdminStatusController: mocks.status,
}));

import coAdminRouter from "./coAdmin.route";

const app = express().use(cookieParser()).use(express.json()).use("/coadmins", coAdminRouter);
const account = (role: "ADMIN" | "COADMIN") => ({
  id: `${role.toLowerCase()}-1`, uid: `${role.toLowerCase()}-uid`, fullName: role,
  email: `${role.toLowerCase()}@example.com`, phone: null, role, isActive: true,
});

describe("co-admin management authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "admin-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue(account("ADMIN"));
    mocks.verifyMfaProof.mockReturnValue(true);
  });

  it("blocks COADMIN from inviting another co-admin", async () => {
    mocks.userFindUnique.mockResolvedValue(account("COADMIN"));
    await request(app).post("/coadmins/invite").set("Authorization", "Bearer token").send({
      fullName: "Operations Admin", email: "ops@example.com",
    }).expect(403);
  });

  it("blocks ADMIN without MFA", async () => {
    mocks.verifyMfaProof.mockReturnValue(false);
    await request(app).post("/coadmins/invite").set("Authorization", "Bearer token").send({
      fullName: "Operations Admin", email: "ops@example.com",
    }).expect(403);
  });

  it("allows an MFA-verified ADMIN", async () => {
    await request(app).post("/coadmins/invite")
      .set("Authorization", "Bearer token")
      .set("Cookie", "__Host-admin_mfa=proof")
      .send({ fullName: "Operations Admin", email: "ops@example.com" })
      .expect(201);
  });
});
