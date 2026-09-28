import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { PaymentAttemptRecord, PaymentChargeRecord, PersistedChargeInput } from "./types";

export interface PaymentChargeRepository {
  createCharge(input: PersistedChargeInput): Promise<PaymentChargeRecord>;
  findCharge(chargeId: string): Promise<PaymentChargeRecord | null>;
  cancelOpenCharge(chargeId: string, userId: string, cancelledAt: Date): Promise<boolean>;
}

export interface PaymentAttemptRepository {
  findCharge(chargeId: string): Promise<PaymentChargeRecord | null>;
  findReusableAttempt(chargeId: string, now: Date): Promise<PaymentAttemptRecord | null>;
  createAttempt(input: {
    chargeId: string;
    amountMinor: number;
    currency: string;
    expiresAt: Date;
  }): Promise<PaymentAttemptRecord>;
  markAttemptPending(input: { attemptId: string; gatewayOrderId: string; gatewayResponse: unknown }): Promise<PaymentAttemptRecord>;
  markAttemptFailed(input: { attemptId: string; failureCode: string; failureDescription: string }): Promise<void>;
  expireOtherAttempts(chargeId: string, activeAttemptId: string, now: Date): Promise<void>;
}

type PaymentChargeClient = Pick<Prisma.TransactionClient, "paymentCharge">;

export const createPaymentChargeRepository = (client: PaymentChargeClient): PaymentChargeRepository => ({
  createCharge(input) {
    return client.paymentCharge.create({ data: input });
  },
  findCharge(chargeId) {
    return client.paymentCharge.findUnique({ where: { id: chargeId } });
  },
  async cancelOpenCharge(chargeId, userId, cancelledAt) {
    const result = await client.paymentCharge.updateMany({
      where: { id: chargeId, userId, status: "OPEN", paidAttemptId: null },
      data: { status: "CANCELLED", cancelledAt },
    });
    return result.count === 1;
  },
});

export const paymentChargeRepository = createPaymentChargeRepository(prisma);

export const paymentAttemptRepository: PaymentAttemptRepository = {
  findCharge(chargeId) {
    return prisma.paymentCharge.findUnique({ where: { id: chargeId } });
  },
  findReusableAttempt(chargeId, now) {
    return prisma.paymentAttempt.findFirst({
      where: {
        chargeId,
        status: { in: ["CREATING", "PENDING", "AUTHORIZED"] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
  },
  createAttempt(input) {
    return prisma.paymentAttempt.create({
      data: { ...input, gateway: "RAZORPAY", status: "CREATING" },
    });
  },
  markAttemptPending(input) {
    return prisma.paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        gatewayOrderId: input.gatewayOrderId,
        gatewayResponse: input.gatewayResponse as object,
        status: "PENDING",
      },
    });
  },
  async markAttemptFailed(input) {
    await prisma.paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: "FAILED",
        failureCode: input.failureCode,
        failureDescription: input.failureDescription,
      },
    });
  },
  async expireOtherAttempts(chargeId, activeAttemptId, now) {
    await prisma.paymentAttempt.updateMany({
      where: {
        chargeId,
        id: { not: activeAttemptId },
        status: { in: ["CREATING", "PENDING", "AUTHORIZED"] },
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });
  },
};
