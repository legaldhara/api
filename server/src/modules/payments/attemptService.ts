import { PaymentDomainError } from "./chargeService";
import { PaymentAttemptRepository, paymentAttemptRepository } from "./repository";
import { RazorpayGateway, razorpayGateway } from "./razorpayGateway";
import { PaymentActor, PaymentAttemptRecord } from "./types";

interface AttemptDependencies {
  repository: PaymentAttemptRepository;
  gateway: RazorpayGateway;
  now: () => Date;
  keyId: string;
  attemptLifetimeMs: number;
}

const dependencies = (overrides: Partial<AttemptDependencies> = {}): AttemptDependencies => ({
  repository: paymentAttemptRepository,
  gateway: razorpayGateway,
  now: () => new Date(),
  keyId: process.env.RAZORPAY_KEY_ID ?? "",
  attemptLifetimeMs: 15 * 60 * 1000,
  ...overrides,
});

export interface PaymentCheckoutAttempt {
  attemptId: string;
  chargeId: string;
  gatewayOrderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
}

const checkout = (attempt: PaymentAttemptRecord, keyId: string): PaymentCheckoutAttempt => {
  if (!attempt.gatewayOrderId) {
    throw new PaymentDomainError("Payment attempt is not ready", 409, "ATTEMPT_NOT_READY");
  }
  return {
    attemptId: attempt.id,
    chargeId: attempt.chargeId,
    gatewayOrderId: attempt.gatewayOrderId,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    keyId,
  };
};

export const createOrReuseAttempt = async (
  input: { chargeId: string; actor: PaymentActor },
  overrides: Partial<AttemptDependencies> = {},
): Promise<PaymentCheckoutAttempt> => {
  const deps = dependencies(overrides);
  const charge = await deps.repository.findCharge(input.chargeId);
  if (!charge || (input.actor.role === "USER" && charge.userId !== input.actor.id)) {
    throw new PaymentDomainError("Charge not found", 404, "CHARGE_NOT_FOUND");
  }
  if (charge.status !== "OPEN") {
    throw new PaymentDomainError("Charge is not open", 409, "CHARGE_NOT_OPEN");
  }

  const now = deps.now();
  const reusable = await deps.repository.findReusableAttempt(charge.id, now);
  if (reusable?.gatewayOrderId) return checkout(reusable, deps.keyId);
  if (reusable) throw new PaymentDomainError("Payment attempt is still being created", 409, "ATTEMPT_CREATING");

  const attempt = await deps.repository.createAttempt({
    chargeId: charge.id,
    amountMinor: charge.amountMinor,
    currency: charge.currency,
    expiresAt: new Date(now.getTime() + deps.attemptLifetimeMs),
  });

  try {
    const order = await deps.gateway.createOrder({
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      receipt: attempt.id,
      notes: { attemptId: attempt.id, chargeId: charge.id, targetType: charge.targetType },
    });
    if (order.amount !== charge.amountMinor || order.currency !== charge.currency) {
      throw new Error("Gateway returned mismatched order values");
    }
    const pending = await deps.repository.markAttemptPending({
      attemptId: attempt.id,
      gatewayOrderId: order.id,
      gatewayResponse: order,
    });
    await deps.repository.expireOtherAttempts(charge.id, attempt.id, now);
    return checkout(pending, deps.keyId);
  } catch (error) {
    const description = error instanceof Error ? error.message : "Razorpay order creation failed";
    await deps.repository.markAttemptFailed({
      attemptId: attempt.id,
      failureCode: "ORDER_CREATION_FAILED",
      failureDescription: description.slice(0, 200),
    });
    throw new PaymentDomainError("Unable to start payment", 502, "GATEWAY_ORDER_FAILED");
  }
};
