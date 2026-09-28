import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  securityFindUnique: vi.fn(),
  verifyMfaProof: vi.fn(),
}));

vi.mock("../config/db", () => ({ prisma: { adminSecurity: { findUnique: mocks.securityFindUnique } } }));
vi.mock("../services/adminMfa", () => ({ verifyMfaProof: mocks.verifyMfaProof }));

import { getSession } from "./session.controller";

const response = () => {
  const value = { status: vi.fn(), json: vi.fn() };
  value.status.mockReturnValue(value);
  return value as any;
};

describe("administrative session state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMfaProof.mockReturnValue(false);
  });

  it("reports a co-admin without configured MFA as unenrolled", async () => {
    mocks.securityFindUnique.mockResolvedValue(null);
    const res = response();

    await getSession({ auth: { id: "coadmin-1", uid: "firebase-1", role: "COADMIN" }, cookies: {} } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnrolled: false, mfaVerified: false }));
  });

  it("reports enabled MFA separately from current verification", async () => {
    mocks.securityFindUnique.mockResolvedValue({ enabledAt: new Date("2026-09-26T10:00:00.000Z") });
    const res = response();

    await getSession({ auth: { id: "admin-1", uid: "firebase-1", role: "ADMIN" }, cookies: {} } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnrolled: true, mfaVerified: false }));
  });

  it("recognizes a development bypass proof without marking MFA enrolled", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBypass = process.env.ALLOW_ADMIN_MFA_BYPASS;
    process.env.NODE_ENV = "development";
    process.env.ALLOW_ADMIN_MFA_BYPASS = "true";
    mocks.securityFindUnique.mockResolvedValue(null);
    mocks.verifyMfaProof.mockReturnValue(true);
    const res = response();

    await getSession({ auth: { id: "admin-1", uid: "firebase-1", role: "ADMIN" }, cookies: { "__Host-admin_mfa": "proof" } } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnrolled: false, mfaVerified: true }));
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ALLOW_ADMIN_MFA_BYPASS = originalBypass;
  });

  it("does not require MFA enrollment for customer sessions", async () => {
    const res = response();

    await getSession({ auth: { id: "user-1", uid: "firebase-1", role: "USER" }, cookies: {} } as any, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnrolled: true, mfaVerified: true }));
    expect(mocks.securityFindUnique).not.toHaveBeenCalled();
  });
});
