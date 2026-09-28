import { describe, expect, it, vi } from "vitest";
import { reconcileAttempt, reconcileStaleAttempts } from "./reconciliationService";

const staleAttempt = {
  id: "attempt-1",
  chargeId: "charge-1",
  gatewayOrderId: "order-1",
  amountMinor: 50_000,
  currency: "INR",
  status: "PENDING" as const,
};

const dependencies = () => ({
  repository: {
    findAttempt: vi.fn(async () => staleAttempt),
    findStaleAttempts: vi.fn(async () => [staleAttempt]),
    acquireLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => undefined),
    recordRetryableError: vi.fn(async () => undefined),
  },
  gateway: {
    fetchOrder: vi.fn(async () => ({ id: "order-1", status: "paid", amountPaid: 50_000, currency: "INR" })),
    findCapturedPayment: vi.fn(async () => ({
      id: "pay-1",
      orderId: "order-1",
      status: "captured",
      amount: 50_000,
      currency: "INR",
      method: "upi",
    })),
  },
  settlement: {
    settleProviderPayment: vi.fn(async () => ({ outcome: "SETTLED" as const })),
    recordProviderFailure: vi.fn(async () => undefined),
  },
  now: () => new Date("2026-09-27T00:00:00.000Z"),
  holderId: "instance-1",
});

describe("payment reconciliation", () => {
  it("recovers a captured payment whose webhook was missed", async () => {
    const deps = dependencies();

    await reconcileAttempt("attempt-1", deps);

    expect(deps.settlement.settleProviderPayment).toHaveBeenCalledWith(expect.objectContaining({
      gatewayPaymentId: "pay-1",
      amountMinor: 50_000,
    }));
  });

  it("does not run a second batch while another lease is active", async () => {
    const deps = dependencies();
    deps.repository.acquireLease.mockResolvedValue(false);

    await reconcileStaleAttempts({ limit: 50 }, deps);

    expect(deps.repository.findStaleAttempts).not.toHaveBeenCalled();
  });
});
