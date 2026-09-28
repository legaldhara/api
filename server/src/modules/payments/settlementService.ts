import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { PaymentDomainError } from "./chargeService";
import { PaymentTargetAdapter, paymentTargetAdapter } from "./targetAdapters";
import { PaymentAttemptStatus, PaymentChargeRecord } from "./types";

interface SettlementAttempt {
  id: string;
  chargeId: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  charge: PaymentChargeRecord;
}

export interface SettlementTransaction {
  findAttemptForUpdate(attemptId: string): Promise<SettlementAttempt | null>;
  claimOpenCharge(input: { chargeId: string; attemptId: string; paidAt: Date }): Promise<boolean>;
  markAttemptSuccess(input: {
    attemptId: string;
    gatewayPaymentId: string;
    paymentMethod?: string;
    gatewayResponse?: unknown;
    settledAt: Date;
  }): Promise<void>;
  markAttemptDuplicateSuccess(input: {
    attemptId: string;
    gatewayPaymentId: string;
    paymentMethod?: string;
    gatewayResponse?: unknown;
    settledAt: Date;
  }): Promise<void>;
  markAttemptFailed(input: { attemptId: string; failureCode?: string; failureDescription?: string }): Promise<void>;
}

export interface SettlementRepository {
  withTransaction<T>(operation: (transaction: SettlementTransaction) => Promise<T>): Promise<T>;
}

const createTransaction = (tx: Prisma.TransactionClient): SettlementTransaction => ({
  async findAttemptForUpdate(attemptId) {
    await tx.$queryRaw`SELECT "id" FROM "PaymentAttempt" WHERE "id" = ${attemptId}::uuid FOR UPDATE`;
    return tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { charge: true } });
  },
  async claimOpenCharge(input) {
    const result = await tx.paymentCharge.updateMany({
      where: { id: input.chargeId, status: "OPEN", paidAttemptId: null },
      data: { status: "PAID", paidAttemptId: input.attemptId, paidAt: input.paidAt },
    });
    return result.count === 1;
  },
  async markAttemptSuccess(input) {
    await tx.paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: "SUCCESS",
        gatewayPaymentId: input.gatewayPaymentId,
        paymentMethod: input.paymentMethod,
        gatewayResponse: input.gatewayResponse as object | undefined,
        settledAt: input.settledAt,
      },
    });
  },
  async markAttemptDuplicateSuccess(input) {
    await tx.paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: "DUPLICATE_SUCCESS",
        gatewayPaymentId: input.gatewayPaymentId,
        paymentMethod: input.paymentMethod,
        gatewayResponse: input.gatewayResponse as object | undefined,
        settledAt: input.settledAt,
      },
    });
  },
  async markAttemptFailed(input) {
    await tx.paymentAttempt.updateMany({
      where: { id: input.attemptId, status: { in: ["CREATING", "PENDING", "AUTHORIZED"] } },
      data: {
        status: "FAILED",
        failureCode: input.failureCode,
        failureDescription: input.failureDescription,
      },
    });
  },
});

const settlementRepository: SettlementRepository = {
  withTransaction(operation) {
    return prisma.$transaction((tx) => operation(createTransaction(tx)));
  },
};

interface SettlementDependencies {
  repository: SettlementRepository;
  target: PaymentTargetAdapter;
  now: () => Date;
}

const dependencies = (overrides: Partial<SettlementDependencies> = {}): SettlementDependencies => ({
  repository: settlementRepository,
  target: paymentTargetAdapter,
  now: () => new Date(),
  ...overrides,
});

export interface CapturedPaymentInput {
  attemptId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amountMinor: number;
  currency: string;
  providerStatus: "captured";
  paymentMethod?: string;
  gatewayResponse?: unknown;
}

export const settleProviderPayment = (
  input: CapturedPaymentInput,
  overrides: Partial<SettlementDependencies> = {},
): Promise<{ outcome: "SETTLED" | "ALREADY_SETTLED" | "DUPLICATE_SUCCESS" }> => {
  const deps = dependencies(overrides);
  return deps.repository.withTransaction(async (transaction) => {
    const attempt = await transaction.findAttemptForUpdate(input.attemptId);
    if (!attempt) throw new PaymentDomainError("Payment attempt not found", 404, "ATTEMPT_NOT_FOUND");
    if (attempt.gatewayOrderId !== input.gatewayOrderId) {
      throw new PaymentDomainError("Gateway order does not match", 409, "ORDER_MISMATCH");
    }
    if (attempt.amountMinor !== input.amountMinor || attempt.charge.amountMinor !== input.amountMinor) {
      throw new PaymentDomainError("Captured amount does not match", 409, "AMOUNT_MISMATCH");
    }
    if (attempt.currency !== input.currency || attempt.charge.currency !== input.currency || input.currency !== "INR") {
      throw new PaymentDomainError("Captured currency does not match", 409, "CURRENCY_MISMATCH");
    }

    if (attempt.status === "SUCCESS" && attempt.charge.paidAttemptId === attempt.id) {
      return { outcome: "ALREADY_SETTLED" };
    }
    if (attempt.status === "DUPLICATE_SUCCESS" || attempt.charge.status !== "OPEN") {
      if (attempt.status !== "DUPLICATE_SUCCESS") {
        await transaction.markAttemptDuplicateSuccess({
          attemptId: attempt.id,
          gatewayPaymentId: input.gatewayPaymentId,
          paymentMethod: input.paymentMethod,
          gatewayResponse: input.gatewayResponse,
          settledAt: deps.now(),
        });
      }
      return { outcome: "DUPLICATE_SUCCESS" };
    }

    const paidAt = deps.now();
    const claimed = await transaction.claimOpenCharge({ chargeId: attempt.chargeId, attemptId: attempt.id, paidAt });
    if (!claimed) throw new PaymentDomainError("Charge was settled concurrently", 409, "SETTLEMENT_CONFLICT");
    await transaction.markAttemptSuccess({
      attemptId: attempt.id,
      gatewayPaymentId: input.gatewayPaymentId,
      paymentMethod: input.paymentMethod,
      gatewayResponse: input.gatewayResponse,
      settledAt: paidAt,
    });
    await deps.target.applyPaidCharge(attempt.charge, attempt.id, transaction);
    return { outcome: "SETTLED" };
  });
};

export const recordProviderFailure = (
  input: { attemptId: string; failureCode?: string; failureDescription?: string },
  overrides: Partial<SettlementDependencies> = {},
): Promise<void> => dependencies(overrides).repository.withTransaction(async (transaction) => {
  await transaction.markAttemptFailed(input);
});
