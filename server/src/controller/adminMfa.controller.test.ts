import { describe, expect, it, vi } from "vitest";

const { verifyMfa, consumeRecoveryCode, confirmEnrollment } = vi.hoisted(() => ({ verifyMfa: vi.fn(), consumeRecoveryCode: vi.fn(), confirmEnrollment: vi.fn() }));
vi.mock("../services/adminMfa", () => ({ verifyMfa, consumeRecoveryCode, confirmEnrollment, createEnrollment: vi.fn(), createMfaProof: () => "proof" }));

import { confirmMfa, skipAdminMfaForDevelopment, verifyAdminMfa } from "./adminMfa.controller";

const response = () => {
  const value = { status: vi.fn(), json: vi.fn(), cookie: vi.fn() };
  value.status.mockReturnValue(value); value.cookie.mockReturnValue(value);
  return value as any;
};

describe("verifyAdminMfa", () => {
  it("rate limits repeated invalid codes per UID and IP", async () => {
    verifyMfa.mockResolvedValue(false); consumeRecoveryCode.mockResolvedValue(false);
    const request = { auth: { id: "admin-id", uid: "firebase-admin" }, body: { code: "000000" }, ip: "127.0.0.1" } as any;
    const responses = Array.from({ length: 6 }, response);
    for (const item of responses) await verifyAdminMfa(request, item);
    expect(responses[5].status).toHaveBeenCalledWith(429);
    expect(verifyMfa).toHaveBeenCalledTimes(5);
  });

  it("creates the MFA proof when first-time enrollment is confirmed", async () => {
    confirmEnrollment.mockResolvedValue(["recovery-one"]);
    const res = response();

    await confirmMfa({ auth: { id: "admin-id", uid: "firebase-admin" }, body: { code: "123456" } } as any, res);

    expect(res.cookie).toHaveBeenCalledWith("__Host-admin_mfa", "proof", expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ success: true, recoveryCodes: ["recovery-one"] });
  });

  it("allows MFA bypass only when explicitly enabled outside production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBypass = process.env.ALLOW_ADMIN_MFA_BYPASS;
    process.env.NODE_ENV = "development";
    process.env.ALLOW_ADMIN_MFA_BYPASS = "true";
    const res = response();

    await skipAdminMfaForDevelopment({ auth: { uid: "firebase-admin" } } as any, res);

    expect(res.cookie).toHaveBeenCalledWith("__Host-admin_mfa", "proof", expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ success: true });
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ALLOW_ADMIN_MFA_BYPASS = originalBypass;
  });

  it("rejects MFA bypass in production even when the flag is set", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBypass = process.env.ALLOW_ADMIN_MFA_BYPASS;
    process.env.NODE_ENV = "production";
    process.env.ALLOW_ADMIN_MFA_BYPASS = "true";
    const res = response();

    await skipAdminMfaForDevelopment({ auth: { uid: "firebase-admin" } } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.cookie).not.toHaveBeenCalled();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ALLOW_ADMIN_MFA_BYPASS = originalBypass;
  });
});
