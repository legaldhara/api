import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../middleware/authMiddleware", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  authenticateFirebaseIdentity: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../controller/session.controller", () => ({ getSession: (_req: unknown, res: any) => res.json({ success: true }) }));

import authRouter from "./auth.route";

const app = express().use(express.json()).use("/auth", authRouter);

describe("legacy authentication routes", () => {
  const removed = [
    ["post", "/validate"], ["post", "/admin/login"], ["post", "/user/login-by-phone"],
    ["post", "/user/login-by-email"], ["post", "/refresh"], ["post", "/user/register"],
    ["post", "/user/update-password"], ["post", "/logout"], ["post", "/coadmin/register"],
  ] as const;

  it.each(removed)("returns 404 for %s %s", async (method, path) => {
    const response = await (request(app) as any)[method](`/auth${path}`).send({ email: "public@example.com", password: "known-password", phone: "9999999999" });
    expect(response.status).toBe(404);
  });
});

