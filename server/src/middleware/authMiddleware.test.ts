import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const { verifyIdToken, findUnique } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: verifyIdToken }));
vi.mock("../config/db", () => ({ prisma: { user: { findUnique } } }));

import { authenticate } from "./authMiddleware";

const response = () => {
  const result = { status: vi.fn(), json: vi.fn() };
  result.status.mockReturnValue(result);
  return result as unknown as Response;
};

describe("authenticate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects requests without a bearer token", async () => {
    const res = response();
    await authenticate({ headers: {} } as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("verifies revocation and loads the active database user", async () => {
    verifyIdToken.mockResolvedValue({ uid: "firebase-1", email: "admin@example.com" });
    findUnique.mockResolvedValue({ id: "db-1", uid: "firebase-1", email: "admin@example.com", fullName: "Admin", role: "ADMIN", isActive: true });
    const req = { headers: { authorization: "Bearer firebase-token" } } as Request;
    const next = vi.fn() as NextFunction;

    await authenticate(req, response(), next);

    expect(verifyIdToken).toHaveBeenCalledWith("firebase-token", true);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: "firebase-1" } }));
    expect((req as any).auth.role).toBe("ADMIN");
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects disabled database users", async () => {
    verifyIdToken.mockResolvedValue({ uid: "firebase-1" });
    findUnique.mockResolvedValue({ id: "db-1", uid: "firebase-1", role: "USER", isActive: false });
    const res = response();
    await authenticate({ headers: { authorization: "Bearer token" } } as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects an active USER whose Firebase email is unverified", async () => {
    verifyIdToken.mockResolvedValue({ uid: "firebase-1", email_verified: false });
    findUnique.mockResolvedValue({ id: "db-1", uid: "firebase-1", fullName: "User", role: "USER", isActive: true });
    const res = response();

    await authenticate({ headers: { authorization: "Bearer token" } } as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "Verification required" });
  });

  it("accepts an active USER whose Firebase email is verified", async () => {
    verifyIdToken.mockResolvedValue({ uid: "firebase-1", email_verified: true });
    findUnique.mockResolvedValue({ id: "db-1", uid: "firebase-1", fullName: "User", role: "USER", isActive: true });
    const next = vi.fn() as NextFunction;

    await authenticate({ headers: { authorization: "Bearer token" } } as Request, response(), next);

    expect(next).toHaveBeenCalledOnce();
  });});

