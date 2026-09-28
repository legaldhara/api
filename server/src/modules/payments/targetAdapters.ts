import { Prisma } from "@prisma/client";
import { PaymentDomainError } from "./chargeService";
import { PaymentChargeRecord } from "./types";

export interface PaymentTargetRepository {
  advanceApplication(input: {
    applicationId: string;
    sourceUpdateId: string | null;
    attemptId: string;
    allowedCurrentStatuses: string[];
  }, transaction: unknown): Promise<boolean>;
  advanceCertificate(input: {
    certificateRequestId: string;
    sourceUpdateId: string | null;
    attemptId: string;
    allowedCurrentStatuses: string[];
  }, transaction: unknown): Promise<boolean>;
  activatePlan(input: {
    userId: string;
    planId: string;
    attemptId: string;
    activatedAt: Date;
  }, transaction: unknown): Promise<void>;
}

const prismaTargetRepository: PaymentTargetRepository = {
  async advanceApplication(input, transaction) {
    const tx = transaction as Prisma.TransactionClient;
    const result = await tx.application.updateMany({
      where: {
        id: input.applicationId,
        deletedAt: null,
        applicationStatus: { in: input.allowedCurrentStatuses as never[] },
      },
      data: { applicationStatus: "UNDER_REVIEW" },
    });
    if (result.count === 1 && input.sourceUpdateId) {
      await tx.applicationUpdate.updateMany({
        where: { id: input.sourceUpdateId, applicationId: input.applicationId },
        data: { pendingPayment: false, paymentId: input.attemptId },
      });
    }
    return result.count === 1;
  },
  async advanceCertificate(input, transaction) {
    const tx = transaction as Prisma.TransactionClient;
    const result = await tx.certificateRequest.updateMany({
      where: {
        id: input.certificateRequestId,
        deletedAt: null,
        status: { in: input.allowedCurrentStatuses as never[] },
      },
      data: { status: "UNDER_REVIEW", pendingPayment: false },
    });
    if (result.count === 1 && input.sourceUpdateId) {
      await tx.certificateUpdate.updateMany({
        where: { id: input.sourceUpdateId, certificateRequestId: input.certificateRequestId },
        data: { transactionId: input.attemptId, chargesRequired: 0 },
      });
    }
    return result.count === 1;
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
    if (charge.targetType === "APPLICATION" && charge.applicationId) {
      await repository.advanceApplication({
        applicationId: charge.applicationId,
        sourceUpdateId: charge.sourceApplicationUpdateId,
        attemptId,
        allowedCurrentStatuses: ["AWAITING_ACTION", "PAYMENT_REQUIRED", "PAYMENT_DONE", "DATA_REQUIRED", "UNDER_REVIEW"],
      }, transaction);
      return;
    }
    if (charge.targetType === "CERTIFICATE" && charge.certificateRequestId) {
      await repository.advanceCertificate({
        certificateRequestId: charge.certificateRequestId,
        sourceUpdateId: charge.sourceCertificateUpdateId,
        attemptId,
        allowedCurrentStatuses: ["PENDING", "PAYMENT_REQUIRED", "UNDER_REVIEW", "APPROVED"],
      }, transaction);
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
