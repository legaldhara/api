import { Prisma } from "@prisma/client";
import { PaymentDomainError } from "./chargeService";
import { PaymentChargeRecord } from "./types";

export interface PaymentTargetRepository {
  fulfilCasePayment(input: {
    chargeId: string;
    attemptId: string;
  }, transaction: unknown): Promise<void>;
  activatePlan(input: {
    userId: string;
    planId: string;
    attemptId: string;
    activatedAt: Date;
  }, transaction: unknown): Promise<void>;
}

const prismaTargetRepository: PaymentTargetRepository = {
  async fulfilCasePayment(input, transaction) {
    const tx = transaction as Prisma.TransactionClient;
    const requirement = await tx.caseRequirement.findUnique({
      where: { paymentChargeId: input.chargeId },
      include: {
        requestCase: {
          include: {
            _count: { select: { requirements: { where: { status: "OPEN" } } } },
          },
        },
      },
    });
    if (!requirement || requirement.type !== "PAYMENT") {
      throw new PaymentDomainError("Payment requirement not found", 409, "PAYMENT_REQUIREMENT_NOT_FOUND");
    }
    const idempotencyKey = `payment:${input.attemptId}`;
    const duplicate = await tx.caseEvent.findUnique({
      where: { caseId_idempotencyKey: { caseId: requirement.caseId, idempotencyKey } },
    });
    if (duplicate) return;
    if (requirement.status !== "OPEN") {
      throw new PaymentDomainError("Payment requirement is not open", 409, "REQUIREMENT_NOT_OPEN");
    }

    const now = new Date();
    await tx.caseRequirement.update({
      where: { id: requirement.id },
      data: { status: "FULFILLED", fulfilledAt: now },
    });
    const nextStatus = requirement.requestCase._count.requirements === 1 ? "UNDER_REVIEW" : "ACTION_REQUIRED";
    const updated = await tx.requestCase.updateMany({
      where: { id: requirement.caseId, version: requirement.requestCase.version },
      data: { status: nextStatus, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new PaymentDomainError("Case changed; settlement must be retried", 409, "CASE_VERSION_CONFLICT");
    }
    await tx.caseEvent.create({
      data: {
        caseId: requirement.caseId,
        type: "PAYMENT_CONFIRMED",
        previousStatus: requirement.requestCase.status,
        newStatus: nextStatus,
        requirementId: requirement.id,
        paymentChargeId: input.chargeId,
        idempotencyKey,
        metadata: { attemptId: input.attemptId },
        result: {
          caseId: requirement.caseId,
          requirementId: requirement.id,
          status: nextStatus,
        },
      },
    });
  },
  async activatePlan(input, transaction) {
    const tx = transaction as Prisma.TransactionClient;
    const plan = await tx.plan.findFirst({ where: { id: input.planId, deletedAt: null } });
    if (!plan) throw new PaymentDomainError("Plan target not found", 409, "TARGET_NOT_PAYABLE");
    const existing = await tx.userPlan.findFirst({ where: { userId: input.userId, planId: input.planId } });
    const startDate = existing?.endDate && existing.endDate > input.activatedAt ? existing.endDate : input.activatedAt;
    const endDate = new Date(startDate.getTime() + plan.duration * 24 * 60 * 60 * 1000);
    if (existing) {
      await tx.userPlan.update({
        where: { id: existing.id },
        data: { isActive: true, startDate, endDate, paymentAttemptId: input.attemptId },
      });
    } else {
      await tx.userPlan.create({
        data: {
          userId: input.userId,
          planId: input.planId,
          paymentAttemptId: input.attemptId,
          startDate,
          endDate,
          isActive: true,
        },
      });
    }
  },
};

export interface PaymentTargetAdapter {
  applyPaidCharge(charge: PaymentChargeRecord, attemptId: string, transaction: unknown): Promise<void>;
}

export const createPaymentTargetAdapter = (
  repository: PaymentTargetRepository = prismaTargetRepository,
): PaymentTargetAdapter => ({
  async applyPaidCharge(charge, attemptId, transaction) {
    if (
      (charge.targetType === "APPLICATION" && charge.applicationId) ||
      (charge.targetType === "CERTIFICATE" && charge.certificateRequestId)
    ) {
      await repository.fulfilCasePayment({ chargeId: charge.id, attemptId }, transaction);
      return;
    }
    if (charge.targetType === "PLAN" && charge.planId) {
      await repository.activatePlan({
        userId: charge.userId,
        planId: charge.planId,
        attemptId,
        activatedAt: new Date(),
      }, transaction);
      return;
    }
    throw new PaymentDomainError("Charge target is invalid", 409, "INVALID_TARGET");
  },
});

export const paymentTargetAdapter = createPaymentTargetAdapter();
