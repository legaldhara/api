import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));
vi.mock("../config/db", () => ({ prisma: { adminSecurity: { updateMany } } }));

import { acceptMfaTimeStep, createMfaProof, verifyMfaProof } from "./adminMfa";

describe("admin MFA proof", () => {
  beforeEach(() => {
    process.env.ADMIN_MFA_SIGNING_SECRET = "test-admin-mfa-signing-secret-at-least-32-characters";
  });
  it("binds a short-lived proof to the Firebase UID", () => {
    const proof = createMfaProof("firebase-admin", 1_000);
    expect(verifyMfaProof(proof, "firebase-admin", 1_001)).toBe(true);
    expect(verifyMfaProof(proof, "another-admin", 1_001)).toBe(false);
  });

  it("rejects expired and forged proofs", () => {
    const proof = createMfaProof("firebase-admin", 1_000);
    expect(verifyMfaProof(proof, "firebase-admin", 30_000_000)).toBe(false);
    expect(verifyMfaProof(`${proof}x`, "firebase-admin", 1_001)).toBe(false);
  });

  it("atomically rejects reuse of an accepted TOTP time step", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(acceptMfaTimeStep("admin-id", 60_000)).resolves.toBe(true);
    await expect(acceptMfaTimeStep("admin-id", 60_000)).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "admin-id", OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: 2n } }] },
      data: { lastAcceptedTimeStep: 2n },
    });
  });
});

