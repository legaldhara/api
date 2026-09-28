import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyFirebaseIdToken: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("../config/firebase", () => ({ verifyFirebaseIdToken: mocks.verifyFirebaseIdToken }));
vi.mock("../config/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
  },
}));

import userRouter from "./user.route";

const app = express().use(express.json()).use("/user", userRouter);
const existingUser = {
  id: "11111111-1111-4111-8111-111111111111",
  uid: "user-uid",
  fullName: "Existing User",
  email: "existing@example.com",
  phone: "+919876543210",
  dob: null,
  gender: null,
  city: "Delhi",
  role: "USER",
  isActive: true,
};

describe("profile update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "user-uid", email_verified: true });
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.userUpdate.mockResolvedValue({ fullName: "Updated User", dob: null, gender: null, city: "Delhi" });
  });

  it("rejects attempts to replace a verified email", async () => {
    const response = await request(app).put("/user/update")
      .set("Authorization", "Bearer token")
      .send({ fullName: "Updated User", email: "attacker@example.com" });

    expect(response.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("updates only safe profile fields", async () => {
    const response = await request(app).put("/user/update")
      .set("Authorization", "Bearer token")
      .send({ fullName: "  Updated User  " });

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fullName: "Updated User" }),
    }));
    expect(mocks.userUpdate.mock.calls[0][0].data).not.toHaveProperty("email");
    expect(mocks.userUpdate.mock.calls[0][0].data).not.toHaveProperty("phone");
  });
});
