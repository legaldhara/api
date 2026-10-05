import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  userFindUnique: vi.fn(),
  verifyMfaProof: vi.fn(),
  postMessage: vi.fn((_request, response) => response.status(200).json({ success: true })),
  requestDocuments: vi.fn((_request, response) => response.status(200).json({ success: true })),
}));

vi.mock("../../config/firebase", () => ({ verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("../../config/db", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("../../services/adminMfa", () => ({ verifyMfaProof: mocks.verifyMfaProof }));
vi.mock("./case.controller", () => ({
  getCase: vi.fn(),
  startReview: vi.fn(),
  postMessage: mocks.postMessage,
  requestDocuments: mocks.requestDocuments,
  submitDocuments: vi.fn(),
  requestPayment: vi.fn(),
  cancelRequirement: vi.fn(),
  approveCase: vi.fn(),
  rejectCase: vi.fn(),
  attachDeliverable: vi.fn(),
  completeCase: vi.fn(),
  closeCase: vi.fn(),
}));

import caseRouter from "./case.route";

const app = express()
  .use(cookieParser())
  .use(express.json())
  .use("/api/v1/cases", caseRouter);

const account = (role: "USER" | "ADMIN") => ({
  id: `${role.toLowerCase()}-1`,
  uid: `${role.toLowerCase()}-uid`,
  fullName: `${role} Account`,
  email: `${role.toLowerCase()}@example.com`,
  phone: "+919876543210",
  role,
  isActive: true,
});

describe("case command routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "user-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue(account("USER"));
    mocks.verifyMfaProof.mockReturnValue(true);
  });

  it("rejects a client-supplied event type and status", async () => {
    const response = await request(app)
      .post("/api/v1/cases/11111111-1111-4111-8111-111111111111/messages")
      .set("Authorization", "Bearer token")
      .send({
        message: "Question",
        type: "PAYMENT_CONFIRMED",
        status: "COMPLETED",
        expectedVersion: 2,
        idempotencyKey: "message-1",
      });

    expect(response.status).toBe(400);
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("requires admin MFA for document requests", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "admin-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue(account("ADMIN"));
    mocks.verifyMfaProof.mockReturnValue(false);

    const response = await request(app)
      .post("/api/v1/cases/11111111-1111-4111-8111-111111111111/requirements/documents")
      .set("Authorization", "Bearer token")
      .send({
        expectedVersion: 2,
        idempotencyKey: "documents-1",
        title: "Identity documents",
        instructions: "Upload readable copies",
        documentLabels: ["PAN"],
      });

    expect(response.status).toBe(403);
    expect(mocks.requestDocuments).not.toHaveBeenCalled();
  });

  it("accepts a strict customer message", async () => {
    const response = await request(app)
      .post("/api/v1/cases/11111111-1111-4111-8111-111111111111/messages")
      .set("Authorization", "Bearer token")
      .send({ message: "Question", expectedVersion: 2, idempotencyKey: "message-1" });

    expect(response.status).toBe(200);
    expect(mocks.postMessage).toHaveBeenCalledTimes(1);
  });
});
