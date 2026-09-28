import { prisma } from "../../config/db";
import { PaymentDomainError } from "./chargeService";
import { RazorpayGateway, razorpayGateway } from "./razorpayGateway";

interface RefundableAttempt {
  id: string;
  chargeId: string;
  gatewayPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: "SUCCESS" | "DUPLICATE_SUCCESS" | string;
  charge: { id: string; paidAttemptId: string | null; status: string };
  refund: { id: string; status: string; gatewayRefundId?: string | null } | null;
}

export interface RefundRepository {
  findRefundableAttempt(attemptId: string): Promise<RefundableAttempt | null>;
  createRequestedRefund(input: {
    chargeId: string;
    attemptId: string;
    requestedBy: string;
    amountMinor: number;
    currency: string;
    reason: string;
  }): Promise<{ id: string; status: string }>;
  markRefundPending(input: { refundId: string; gatewayRefundId: string; gatewayResponse: unknown }): Promise<void>;
  markRefundFailed(input: { refundId: string; reason: string; gatewayRefundId?: string; gatewayResponse?: unknown }): Promise<void>;
  confirmRefund(input: { attemptId: string; gatewayRefundId: string; gatewayResponse?: unknown; processedAt: Date }): Promise<void>;
  markChargeRefunded(input: { chargeId: string; attemptId: string; refundedAt: Date }): Promise<void>;
}

const refundRepository: RefundRepository = {
  findRefundableAttempt(attemptId) {
    return prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { charge: { select: { id: true, paidAttemptId: true, status: true } }, refund: true },
    });
  },
  createRequestedRefund(input) {
    return prisma.paymentRefund.create({ data: { ...input, status: "REQUESTED" } });
  },
  async markRefundPending(input) {
    await prisma.paymentRefund.update({
      where: { id: input.refundId },
      data: { status: "PENDING", gatewayRefundId: input.gatewayRefundId, gatewayResponse: input.gatewayResponse as object },
    });
  },
  async markRefundFailed(input) {
    await prisma.paymentRefund.update({
      where: { id: input.refundId },
      data: {
        status: "FAILED",
        gatewayRefundId: input.gatewayRefundId,
        gatewayResponse: input.gatewayResponse as object | undefined ?? { error: input.reason.slice(0, 200) },
      },
    });
  },
  async confirmRefund(input) {
    await prisma.paymentRefund.update({
      where: { attemptId: input.attemptId },
      data: {
        status: "PROCESSED",
        gatewayRefundId: input.gatewayRefundId,
        gatewayResponse: input.gatewayResponse as object | undefined,
        processedAt: input.processedAt,
      },
    });
  },
  async markChargeRefunded(input) {
    await prisma.paymentCharge.updateMany({
      where: { id: input.chargeId, status: "PAID", paidAttemptId: input.attemptId },
      data: { status: "REFUNDED", refundedAt: input.refundedAt },
    });
  },
};

interface RefundDependencies {
  repository: RefundRepository;
  gateway: Pick<RazorpayGateway, "createFullRefund">;
  now: () => Date;
}

const dependencies = (overrides: Partial<RefundDependencies> = {}): RefundDependencies => ({
  repository: refundRepository,
  gateway: razorpayGateway,
  now: () => new Date(),
  ...overrides,
});

export const requestFullRefund = async (
  input: { attemptId: string; actorId: string; reason: string },
  overrides: Partial<RefundDependencies> = {},
) => {
  const deps = dependencies(overrides);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new PaymentDomainError("Refund reason must contain 5 to 300 characters", 400, "INVALID_REFUND_REASON");
  }

  const attempt = await deps.repository.findRefundableAttempt(input.attemptId);
  if (!attempt || !["SUCCESS", "DUPLICATE_SUCCESS"].includes(attempt.status) || !attempt.gatewayPaymentId) {
    throw new PaymentDomainError("Payment attempt cannot be refunded", 409, "ATTEMPT_NOT_REFUNDABLE");
  }
  if (attempt.refund) return attempt.refund;

  const refund = await deps.repository.createRequestedRefund({
    chargeId: attempt.chargeId,
    attemptId: attempt.id,
    requestedBy: input.actorId,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    reason,
  });
  try {
    const providerRefund = await deps.gateway.createFullRefund(attempt.gatewayPaymentId, {
      attemptId: attempt.id,
      chargeId: attempt.chargeId,
      requestedBy: input.actorId,
    });
    await deps.repository.markRefundPending({
      refundId: refund.id,
      gatewayRefundId: providerRefund.id,
      gatewayResponse: providerRefund,
    });
    return { ...refund, status: "PENDING", gatewayRefundId: providerRefund.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Razorpay refund failed";
    await deps.repository.markRefundFailed({ refundId: refund.id, reason: message });
    throw new PaymentDomainError("Unable to request refund", 502, "REFUND_REQUEST_FAILED");
  }
};

export const confirmRefund = async (
  input: { attemptId: string; gatewayRefundId: string; status: "processed"; gatewayResponse?: unknown },
  overrides: Partial<RefundDependencies> = {},
): Promise<void> => {
  const deps = dependencies(overrides);
  const attempt = await deps.repository.findRefundableAttempt(input.attemptId);
  if (!attempt?.refund) throw new PaymentDomainError("Refund request not found", 404, "REFUND_NOT_FOUND");
  const processedAt = deps.now();
  await deps.repository.confirmRefund({
    attemptId: attempt.id,
    gatewayRefundId: input.gatewayRefundId,
    gatewayResponse: input.gatewayResponse,
    processedAt,
  });
  if (attempt.status === "SUCCESS" && attempt.charge.paidAttemptId === attempt.id) {
    await deps.repository.markChargeRefunded({ chargeId: attempt.chargeId, attemptId: attempt.id, refundedAt: processedAt });
  }
};

export const recordRefundFailure = async (
  input: { attemptId: string; gatewayRefundId: string; reason?: string; gatewayResponse?: unknown },
  overrides: Partial<RefundDependencies> = {},
): Promise<void> => {
  const deps = dependencies(overrides);
  const attempt = await deps.repository.findRefundableAttempt(input.attemptId);
  if (!attempt?.refund) throw new PaymentDomainError("Refund request not found", 404, "REFUND_NOT_FOUND");
  await deps.repository.markRefundFailed({
    refundId: attempt.refund.id,
    gatewayRefundId: input.gatewayRefundId,
    reason: input.reason ?? "Razorpay refund failed",
    gatewayResponse: input.gatewayResponse,
  });
};
