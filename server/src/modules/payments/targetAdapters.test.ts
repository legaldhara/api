import { describe, expect, it, vi } from "vitest";
import { createPaymentTargetAdapter } from "./targetAdapters";

describe("payment target adapters", () => {
  it("does not regress a completed application", async () => {
    const repository = {
      advanceApplication: vi.fn(async () => false),
      advanceCertificate: vi.fn(async () => false),
      activatePlan: vi.fn(async () => undefined),
    };
    const adapter = createPaymentTargetAdapter(repository);

    await adapter.applyPaidCharge({
      id: "charge-1",
      userId: "user-1",
      targetType: "APPLICATION",
      applicationId: "application-1",
      certificateRequestId: null,
      planId: null,
      sourceApplicationUpdateId: null,
      sourceCertificateUpdateId: null,
      category: "INITIAL",
      amountMinor: 50_000,
      currency: "INR",
      purpose: "Application charge",
      status: "OPEN",
      paidAttemptId: null,
      paidAt: null,
      refundedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, "attempt-1", {});

    expect(repository.advanceApplication).toHaveBeenCalledWith(expect.objectContaining({
      allowedCurrentStatuses: ["AWAITING_ACTION", "PAYMENT_REQUIRED", "PAYMENT_DONE", "DATA_REQUIRED", "UNDER_REVIEW"],
    }), {});
  });
});
