import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db";
import { RazorpayGateway, razorpayGateway } from "./razorpayGateway";
import { recordProviderFailure, settleProviderPayment } from "./settlementService";
import { PaymentAttemptStatus } from "./types";

interface ReconciliationAttempt {
  id: string;
  chargeId: string;
  gatewayOrderId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
}

export interface ReconciliationRepository {
  findAttempt(attemptId: string): Promise<ReconciliationAttempt | null>;
  findStaleAttempts(input: { before: Date; limit: number }): Promise<ReconciliationAttempt[]>;
  acquireLease(input: { name: string; holderId: string; now: Date; expiresAt: Date }): Promise<boolean>;
  releaseLease(input: { name: string; holderId: string; now: Date }): Promise<void>;
  recordRetryableError(input: { attemptId: string; message: string }): Promise<void>;
}

const reconciliationRepository: ReconciliationRepository = {
  findAttempt(attemptId) {
    return prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
  },
  findStaleAttempts(input) {
    return prisma.paymentAttempt.findMany({
      where: {
        status: { in: ["CREATING", "PENDING", "AUTHORIZED"] },
        updatedAt: { lte: input.before },
        gatewayOrderId: { not: null },
      },
      orderBy: { updatedAt: "asc" },
      take: input.limit,
    });
  },
  async acquireLease(input) {
    const rows = await prisma.$queryRaw<Array<{ holderId: string }>>`
      INSERT INTO "ScheduledJobLease" ("name", "holderId", "expiresAt", "updatedAt")
      VALUES (${input.name}, ${input.holderId}, ${input.expiresAt}, ${input.now})
      ON CONFLICT ("name") DO UPDATE
      SET "holderId" = EXCLUDED."holderId", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "ScheduledJobLease"."expiresAt" <= ${input.now}
         OR "ScheduledJobLease"."holderId" = ${input.holderId}
      RETURNING "holderId"
    `;
    return rows[0]?.holderId === input.holderId;
  },
  async releaseLease(input) {
    await prisma.scheduledJobLease.updateMany({
      where: { name: input.name, holderId: input.holderId },
      data: { expiresAt: input.now },
    });
  },
  async recordRetryableError(input) {
    await prisma.paymentAttempt.updateMany({
      where: { id: input.attemptId, status: { in: ["CREATING", "PENDING", "AUTHORIZED"] } },
      data: { failureCode: "RECONCILIATION_RETRY", failureDescription: input.message.slice(0, 200) },
    });
  },
};

interface ReconciliationSettlement {
  settleProviderPayment: typeof settleProviderPayment;
  recordProviderFailure: typeof recordProviderFailure;
}

interface ReconciliationDependencies {
  repository: ReconciliationRepository;
  gateway: Pick<RazorpayGateway, "fetchOrder" | "findCapturedPayment">;
  settlement: ReconciliationSettlement;
  now: () => Date;
  holderId: string;
  staleAfterMs: number;
  leaseMs: number;
}

const dependencies = (overrides: Partial<ReconciliationDependencies> = {}): ReconciliationDependencies => ({
  repository: reconciliationRepository,
  gateway: razorpayGateway,
  settlement: { settleProviderPayment, recordProviderFailure },
  now: () => new Date(),
  holderId: `${process.pid}:${randomUUID()}`,
  staleAfterMs: 2 * 60 * 1000,
  leaseMs: 5 * 60 * 1000,
  ...overrides,
});

export const reconcileAttempt = async (
  attemptId: string,
  overrides: Partial<ReconciliationDependencies> = {},
): Promise<"SETTLED" | "PENDING" | "MISSING"> => {
  const deps = dependencies(overrides);
  const attempt = await deps.repository.findAttempt(attemptId);
  if (!attempt?.gatewayOrderId) return "MISSING";
  try {
    const order = await deps.gateway.fetchOrder(attempt.gatewayOrderId);
    const payment = await deps.gateway.findCapturedPayment(attempt.gatewayOrderId);
    if (!payment) return "PENDING";
    await deps.settlement.settleProviderPayment({
      attemptId: attempt.id,
      gatewayOrderId: order.id,
      gatewayPaymentId: payment.id,
      amountMinor: payment.amount,
      currency: payment.currency,
      providerStatus: "captured",
      paymentMethod: payment.method,
      gatewayResponse: { order, payment },
    });
    return "SETTLED";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reconciliation provider error";
    await deps.repository.recordRetryableError({ attemptId, message });
    throw error;
  }
};

export const reconcileStaleAttempts = async (
  input: { limit: number },
  overrides: Partial<ReconciliationDependencies> = {},
): Promise<{ acquired: boolean; processed: number }> => {
  const deps = dependencies(overrides);
  const now = deps.now();
  const acquired = await deps.repository.acquireLease({
    name: "payment-reconciliation",
    holderId: deps.holderId,
    now,
    expiresAt: new Date(now.getTime() + deps.leaseMs),
  });
  if (!acquired) return { acquired: false, processed: 0 };

  let processed = 0;
  try {
    const attempts = await deps.repository.findStaleAttempts({
      before: new Date(now.getTime() - deps.staleAfterMs),
      limit: Math.max(1, Math.min(input.limit, 50)),
    });
    for (const attempt of attempts) {
      try {
        await reconcileAttempt(attempt.id, deps);
      } catch {
        processed += 1;
        continue;
      }
      processed += 1;
    }
    return { acquired: true, processed };
  } finally {
    await deps.repository.releaseLease({ name: "payment-reconciliation", holderId: deps.holderId, now: deps.now() });
  }
};
