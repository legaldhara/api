import { describe, expect, it, vi } from "vitest";
import { settleProviderPayment } from "./settlementService";

const charge = (overrides: Record<string, unknown> = {}) => ({
  id: "charge-1",
  userId: "user-1",
  targetType: "APPLICATION" as const,
  applicationId: "application-1",
  certificateRequestId: null,
  planId: null,
  sourceApplicationUpdateId: null,
  sourceCertificateUpdateId: null,
  category: "INITIAL" as const,
  amountMinor: 50_000,
  currency: "INR",
  purpose: "Application charge",
  status: "OPEN" as const,
  paidAttemptId: null,
  paidAt: null,
  refundedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const attempt = (chargeRecord = charge()) => ({
  id: "attempt-1",
  chargeId: "charge-1",
  gatewayOrderId: "order-1",
  gatewayPaymentId: null,
  amountMinor: 50_000,
  currency: "INR",
  status: "PENDING" as const,
  charge: chargeRecord,
});

const captured = {
  attemptId: "attempt-1",
  gatewayOrderId: "order-1",
  gatewayPaymentId: "pay-1",
  amountMinor: 50_000,
  currency: "INR",
  providerStatus: "captured" as const,
  paymentMethod: "upi",
};

const dependencies = (attemptRecord = attempt()) => {
  const transaction = {
    findAttemptForUpdate: vi.fn(async () => attemptRecord),
    claimOpenCharge: vi.fn(async () => true),
    markAttemptSuccess: vi.fn(async () => undefined),
    markAttemptDuplicateSuccess: vi.fn(async () => undefined),
    markAttemptFailed: vi.fn(async () => undefined),
  };
  return {
    repository: { withTransaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction) },
    target: { applyPaidCharge: vi.fn(async () => undefined) },
    now: () => new Date("2026-09-26T00:00:00.000Z"),
    transaction,
  };
};

describe("payment settlement", () => {
  it("settles one matching captured payment exactly once", async () => {
    const deps = dependencies();

    await expect(settleProviderPayment(captured, deps)).resolves.toMatchObject({ outcome: "SETTLED" });
    expect(deps.transaction.claimOpenCharge).toHaveBeenCalledTimes(1);
    expect(deps.target.applyPaidCharge).toHaveBeenCalledTimes(1);
  });

  it("rejects an amount mismatch without advancing the target", async () => {
    const deps = dependencies();

    await expect(settleProviderPayment({ ...captured, amountMinor: 100 }, deps))
      .rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
    expect(deps.target.applyPaidCharge).not.toHaveBeenCalled();
  });

  it("records a second captured attempt without advancing the target twice", async () => {
    const deps = dependencies(attempt(charge({ status: "PAID", paidAttemptId: "attempt-other" })));

    await expect(settleProviderPayment(captured, deps)).resolves.toMatchObject({ outcome: "DUPLICATE_SUCCESS" });
    expect(deps.transaction.markAttemptDuplicateSuccess).toHaveBeenCalledTimes(1);
    expect(deps.target.applyPaidCharge).not.toHaveBeenCalled();
  });
});
