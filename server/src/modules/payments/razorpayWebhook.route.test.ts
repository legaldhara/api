import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRazorpayWebhookRouter } from "./razorpayWebhook.route";

const payload = JSON.stringify({
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: "pay-1",
        order_id: "order-1",
        amount: 50_000,
        currency: "INR",
        status: "captured",
        method: "upi",
        notes: { attemptId: "attempt-1" },
      },
    },
  },
});

const setup = () => {
  const gateway = { verifyWebhook: vi.fn(() => true) };
  const eventRepository = {
    createOnce: vi.fn(async () => true),
    markProcessed: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    markIgnored: vi.fn(async () => undefined),
  };
  const settlement = {
    settleProviderPayment: vi.fn(async () => ({ outcome: "SETTLED" as const })),
    recordProviderFailure: vi.fn(async () => undefined),
  };
  const refund = {
    confirmRefund: vi.fn(async () => undefined),
    recordRefundFailure: vi.fn(async () => undefined),
  };
  const app = express();
  app.use("/api/v1/payments/webhooks/razorpay", createRazorpayWebhookRouter({ gateway, eventRepository, settlement, refund }));
  app.use(express.json());
  return { app, gateway, eventRepository, settlement, refund };
};

describe("Razorpay raw webhook", () => {
  it("validates the signature against exact raw bytes", async () => {
    const { app, gateway } = setup();

    await request(app)
      .post("/api/v1/payments/webhooks/razorpay")
      .set("x-razorpay-signature", "valid")
      .set("x-razorpay-event-id", "event-1")
      .set("content-type", "application/json")
      .send(payload)
      .expect(200);

    expect(gateway.verifyWebhook).toHaveBeenCalledWith(expect.any(Buffer), "valid");
    expect(gateway.verifyWebhook.mock.calls[0][0].toString("utf8")).toBe(payload);
  });

  it("acknowledges a repeated event without settling twice", async () => {
    const { app, eventRepository, settlement } = setup();
    eventRepository.createOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    for (let delivery = 0; delivery < 2; delivery += 1) {
      await request(app)
        .post("/api/v1/payments/webhooks/razorpay")
        .set("x-razorpay-signature", "valid")
        .set("x-razorpay-event-id", "event-1")
        .set("content-type", "application/json")
        .send(payload)
        .expect(200);
    }

    expect(settlement.settleProviderPayment).toHaveBeenCalledTimes(1);
  });

  it("confirms a processed full refund", async () => {
    const { app, refund } = setup();
    const refundPayload = JSON.stringify({
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_1", status: "processed", notes: { attemptId: "attempt-1" } } } },
    });

    await request(app)
      .post("/api/v1/payments/webhooks/razorpay")
      .set("x-razorpay-signature", "valid")
      .set("x-razorpay-event-id", "event-refund-1")
      .set("content-type", "application/json")
      .send(refundPayload)
      .expect(200);

    expect(refund.confirmRefund).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1",
      gatewayRefundId: "rfnd_1",
      status: "processed",
    }));
  });
});
