import { describe, expect, it, vi } from "vitest";
import { createOrReuseAttempt } from "./attemptService";

const charge = {
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
  createdAt: new Date("2026-09-26T00:00:00.000Z"),
  updatedAt: new Date("2026-09-26T00:00:00.000Z"),
};

const pendingAttempt = {
  id: "attempt-1",
  chargeId: "charge-1",
  gateway: "RAZORPAY" as const,
  status: "PENDING" as const,
  amountMinor: 50_000,
  currency: "INR",
  gatewayOrderId: "order_1",
  gatewayPaymentId: null,
  expiresAt: new Date("2026-09-26T00:30:00.000Z"),
};

const dependencies = () => ({
  repository: {
    findCharge: vi.fn(async () => charge),
    findReusableAttempt: vi.fn(async () => null),
    createAttempt: vi.fn(async () => ({ ...pendingAttempt, status: "CREATING" as const, gatewayOrderId: null })),
    markAttemptPending: vi.fn(async () => pendingAttempt),
    markAttemptFailed: vi.fn(async () => undefined),
    expireOtherAttempts: vi.fn(async () => undefined),
  },
  gateway: {
    createOrder: vi.fn(async () => ({ id: "order_1", amount: 50_000, currency: "INR", status: "created" })),
    verifyWebhook: vi.fn(() => true),
    fetchOrder: vi.fn(async () => ({ id: "order_1", status: "created", amountPaid: 0, currency: "INR" })),
    findCapturedPayment: vi.fn(async () => null),
    createFullRefund: vi.fn(async () => ({ id: "rfnd_1", status: "pending" })),
    verifyPaymentSignature: vi.fn(() => true),
    fetchPayment: vi.fn(async () => ({ id: "pay_1", orderId: "order_1", status: "captured", amount: 50_000, currency: "INR" })),
  },
  now: () => new Date("2026-09-26T00:00:00.000Z"),
  keyId: "rzp_test_public",
});

describe("Razorpay attempt creation", () => {
  it("reuses the existing pending Razorpay order", async () => {
    const deps = dependencies();
    deps.repository.findReusableAttempt.mockResolvedValue(pendingAttempt);

    await expect(createOrReuseAttempt({
      chargeId: "charge-1",
      actor: { id: "user-1", role: "USER" },
    }, deps)).resolves.toMatchObject({ gatewayOrderId: "order_1" });
    expect(deps.gateway.createOrder).not.toHaveBeenCalled();
  });

  it("marks a creating attempt failed when Razorpay rejects order creation", async () => {
    const deps = dependencies();
    deps.gateway.createOrder.mockRejectedValue(new Error("provider unavailable"));

    await expect(createOrReuseAttempt({
      chargeId: "charge-1",
      actor: { id: "user-1", role: "USER" },
    }, deps)).rejects.toMatchObject({ statusCode: 502, code: "GATEWAY_ORDER_FAILED" });
    expect(deps.repository.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-1" }));
    expect(deps.repository.expireOtherAttempts).not.toHaveBeenCalled();
  });
});
