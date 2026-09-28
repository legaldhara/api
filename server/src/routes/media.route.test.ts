import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  userFindUnique: vi.fn(),
  verifyMfaProof: vi.fn(),
  uploadImages: vi.fn((_request: unknown, response: any) => response.status(201).json({ success: true })),
  deleteImageHandler: vi.fn((_request: unknown, response: any) => response.status(204).end()),
}));

vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("../config/db", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("../services/adminMfa", () => ({ verifyMfaProof: mocks.verifyMfaProof }));
vi.mock("../controller/media.controller", () => ({
  uploadImages: mocks.uploadImages,
  deleteImageHandler: mocks.deleteImageHandler,
}));

import mediaRouter from "./media.route";

const app = express().use(cookieParser()).use("/media", mediaRouter);

describe("media route upload boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "user-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      uid: "user-uid",
      fullName: "User One",
      email: "user@example.com",
      phone: "+919876543210",
      role: "USER",
      isActive: true,
    });
  });

  it("rejects a fifth file before the upload controller", async () => {
    const call = request(app).post("/media/upload").set("Authorization", "Bearer token");
    for (let index = 0; index < 5; index += 1) {
      call.attach("files", Buffer.from("safe image"), `scan-${index}.png`);
    }
    const response = await call;

    expect(response.status).toBe(400);
    expect(mocks.uploadImages).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types before the upload controller", async () => {
    const response = await request(app).post("/media/upload")
      .set("Authorization", "Bearer token")
      .attach("files", Buffer.from("<html></html>"), "payload.html");

    expect(response.status).toBe(400);
    expect(mocks.uploadImages).not.toHaveBeenCalled();
  });

  it("uses an internal asset ID in the deletion route", async () => {
    await request(app).delete("/media/22222222-2222-4222-8222-222222222222")
      .set("Authorization", "Bearer token")
      .expect(204);

    expect(mocks.deleteImageHandler).toHaveBeenCalled();
  });

  it("does not expose the legacy public-ID deletion route", async () => {
    await request(app).delete("/media/delete/users%2Fsomeone%2Ffile").set("Authorization", "Bearer token").expect(404);
  });
});
