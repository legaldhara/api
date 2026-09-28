import { describe, expect, it, vi } from "vitest";
import { confirmRefund, requestFullRefund } from "./refundService";

const refundableAttempt = (overrides: Record<string, unknown> = {}) => ({
  id: "attempt-1",
  chargeId: "charge-1",
  gatewayPaymentId: "pay-1",
  amountMinor: 50_000,
  currency: "INR",
  status: "SUCCESS" as const,
  charge: { id: "charge-1", paidAttemptId: "attempt-1", status: "PAID" as const },
  refund: null,
  ...overrides,
});

const dependencies = () => {
  let refund: Record<string, unknown> | null = null;
  return {
    repository: {
      findRefundableAttempt: vi.fn(async () => refundableAttempt({ refund })),
      createRequestedRefund: vi.fn(async (input) => {
        refund = { id: "refund-1", status: "REQUESTED", ...input };
        return refund;
      }),
      markRefundPending: vi.fn(async () => undefined),
      markRefundFailed: vi.fn(async () => undefined),
      confirmRefund: vi.fn(async () => undefined),
      markChargeRefunded: vi.fn(async () => undefined),
    },
    gateway: {
      createFullRefund: vi.fn(async () => ({ id: "rfnd_1", status: "pending" })),
    },
    now: () => new Date("2026-09-27T00:00:00.000Z"),
  };
};

describe("full payment refunds", () => {
  it("requests one full refund for a successful attempt", async () => {
    const deps = dependencies();

    await requestFullRefund({ attemptId: "attempt-1", actorId: "admin-1", reason: "Duplicate payment" }, deps);
    await requestFullRefund({ attemptId: "attempt-1", actorId: "admin-1", reason: "Duplicate payment" }, deps);

    expect(deps.gateway.createFullRefund).toHaveBeenCalledTimes(1);
  });

  it("does not change the valid paid charge when refunding a duplicate success", async () => {
    const deps = dependencies();
    deps.repository.findRefundableAttempt.mockResolvedValue(refundableAttempt({
      status: "DUPLICATE_SUCCESS",
      refund: { id: "refund-1", status: "PENDING", gatewayRefundId: "rfnd_1" },
    }));

    await confirmRefund({ attemptId: "attempt-1", gatewayRefundId: "rfnd_1", status: "processed" }, deps);

    expect(deps.repository.markChargeRefunded).not.toHaveBeenCalled();
  });
});
