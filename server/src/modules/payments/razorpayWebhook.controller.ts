import { createHash } from "node:crypto";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { RazorpayGateway, razorpayGateway } from "./razorpayGateway";
import { recordProviderFailure, settleProviderPayment } from "./settlementService";
import { confirmRefund, recordRefundFailure } from "./refundService";

interface WebhookEventInput {
  eventKey: string;
  providerEventId: string | null;
  payloadDigest: string;
  eventType: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  attemptId: string | null;
}

export interface PaymentWebhookEventRepository {
  createOnce(input: WebhookEventInput): Promise<boolean>;
  markProcessed(eventKey: string): Promise<void>;
  markFailed(eventKey: string, reason: string): Promise<void>;
  markIgnored(eventKey: string): Promise<void>;
}

const paymentWebhookEventRepository: PaymentWebhookEventRepository = {
  async createOnce(input) {
    try {
      await prisma.paymentWebhookEvent.create({ data: input });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  },
  async markProcessed(eventKey) {
    await prisma.paymentWebhookEvent.update({ where: { eventKey }, data: { status: "PROCESSED", processedAt: new Date() } });
  },
  async markFailed(eventKey, reason) {
    await prisma.paymentWebhookEvent.update({
      where: { eventKey },
      data: { status: "FAILED", failureReason: reason.slice(0, 300), processedAt: new Date() },
    });
  },
  async markIgnored(eventKey) {
    await prisma.paymentWebhookEvent.update({ where: { eventKey }, data: { status: "IGNORED", processedAt: new Date() } });
  },
};

interface SettlementHandlers {
  settleProviderPayment: typeof settleProviderPayment;
  recordProviderFailure: typeof recordProviderFailure;
}

interface RefundHandlers {
  confirmRefund: typeof confirmRefund;
  recordRefundFailure: typeof recordRefundFailure;
}

export interface RazorpayWebhookDependencies {
  gateway: Pick<RazorpayGateway, "verifyWebhook">;
  eventRepository: PaymentWebhookEventRepository;
  settlement: SettlementHandlers;
  refund: RefundHandlers;
}

const dependencies = (overrides: Partial<RazorpayWebhookDependencies> = {}): RazorpayWebhookDependencies => ({
  gateway: razorpayGateway,
  eventRepository: paymentWebhookEventRepository,
  settlement: { settleProviderPayment, recordProviderFailure },
  refund: { confirmRefund, recordRefundFailure },
  ...overrides,
});

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  error_code?: string;
  error_description?: string;
  notes?: { attemptId?: string };
};

type RazorpayRefundEntity = {
  id?: string;
  status?: string;
  notes?: { attemptId?: string };
  error_description?: string;
};

export const createRazorpayWebhookHandler = (overrides: Partial<RazorpayWebhookDependencies> = {}) => {
  const deps = dependencies(overrides);
  return async (request: Request, response: Response): Promise<void> => {
    const signature = request.header("x-razorpay-signature");
    const body = request.body;
    if (!signature || !Buffer.isBuffer(body) || !deps.gateway.verifyWebhook(body, signature)) {
      response.status(400).json({ success: false, message: "Invalid webhook signature" });
      return;
    }

    const digest = createHash("sha256").update(body).digest("hex");
    let payload: {
      event?: string;
      payload?: {
        payment?: { entity?: RazorpayPaymentEntity };
        refund?: { entity?: RazorpayRefundEntity };
      };
    };
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      response.status(400).json({ success: false, message: "Invalid webhook payload" });
      return;
    }

    const eventType = payload.event ?? "unknown";
    const payment = payload.payload?.payment?.entity;
    const refund = payload.payload?.refund?.entity;
    const providerEventId = request.header("x-razorpay-event-id") ?? null;
    const eventKey = providerEventId ? `razorpay:${providerEventId}` : `sha256:${digest}`;
    const eventInput: WebhookEventInput = {
      eventKey,
      providerEventId,
      payloadDigest: digest,
      eventType,
      gatewayOrderId: payment?.order_id ?? null,
      gatewayPaymentId: payment?.id ?? null,
      attemptId: payment?.notes?.attemptId ?? refund?.notes?.attemptId ?? null,
    };

    const created = await deps.eventRepository.createOnce(eventInput);
    if (!created) {
      response.status(200).json({ success: true, duplicate: true });
      return;
    }

    try {
      if (eventType === "payment.captured") {
        if (!payment?.notes?.attemptId || !payment.id || !payment.order_id || !payment.amount || !payment.currency) {
          throw new Error("Captured payment is missing required fields");
        }
        await deps.settlement.settleProviderPayment({
          attemptId: payment.notes.attemptId,
          gatewayOrderId: payment.order_id,
          gatewayPaymentId: payment.id,
          amountMinor: payment.amount,
          currency: payment.currency,
          providerStatus: "captured",
          paymentMethod: payment.method,
          gatewayResponse: payment,
        });
        await deps.eventRepository.markProcessed(eventKey);
      } else if (eventType === "payment.failed") {
        if (!payment?.notes?.attemptId) throw new Error("Failed payment is missing attempt ID");
        await deps.settlement.recordProviderFailure({
          attemptId: payment.notes.attemptId,
          failureCode: payment.error_code,
          failureDescription: payment.error_description,
        });
        await deps.eventRepository.markProcessed(eventKey);
      } else if (eventType === "refund.processed") {
        if (!refund?.notes?.attemptId || !refund.id) throw new Error("Processed refund is missing required fields");
        await deps.refund.confirmRefund({
          attemptId: refund.notes.attemptId,
          gatewayRefundId: refund.id,
          status: "processed",
          gatewayResponse: refund,
        });
        await deps.eventRepository.markProcessed(eventKey);
      } else if (eventType === "refund.failed") {
        if (!refund?.notes?.attemptId || !refund.id) throw new Error("Failed refund is missing required fields");
        await deps.refund.recordRefundFailure({
          attemptId: refund.notes.attemptId,
          gatewayRefundId: refund.id,
          reason: refund.error_description,
          gatewayResponse: refund,
        });
        await deps.eventRepository.markProcessed(eventKey);
      } else {
        await deps.eventRepository.markIgnored(eventKey);
      }
      response.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      await deps.eventRepository.markFailed(eventKey, message);
      response.status(500).json({ success: false, message: "Webhook processing failed" });
    }
  };
};
