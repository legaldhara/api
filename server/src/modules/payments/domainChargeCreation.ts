import { Decimal } from "@prisma/client/runtime/library";
import { PaymentDomainError } from "./chargeService";
import { CreateChargeInput, PaymentCategory } from "./types";

const toMinorUnits = (value: Decimal.Value): number => {
  const minor = new Decimal(value).mul(100);
  const amountMinor = minor.toNumber();
  if (!minor.isPositive() || !minor.isInteger() || !Number.isSafeInteger(amountMinor)) {
    throw new PaymentDomainError("Price must resolve to positive integer minor units", 400, "INVALID_PRICE");
  }
  return amountMinor;
};

export const applicationChargeInput = (input: {
  userId: string;
  applicationId: string;
  sourceUpdateId: string;
  servicePrice: Decimal.Value;
  governmentCharges: Decimal.Value;
  category: Extract<PaymentCategory, "INITIAL" | "OBJECTION" | "ADDITIONAL" | "CORRECTION">;
}): CreateChargeInput => ({
  userId: input.userId,
  target: { type: "APPLICATION", applicationId: input.applicationId },
  sourceUpdateId: input.sourceUpdateId,
  category: input.category,
  amountMinor: toMinorUnits(new Decimal(input.servicePrice).add(input.governmentCharges)),
  currency: "INR",
  purpose: input.category === "INITIAL" ? "Initial application charge" : "Application processing charge",
});

export const certificateChargeInput = (input: {
  userId: string;
  certificateRequestId: string;
  sourceUpdateId: string;
  chargesRequired: Decimal.Value;
}): CreateChargeInput => ({
  userId: input.userId,
  target: { type: "CERTIFICATE", certificateRequestId: input.certificateRequestId },
  sourceUpdateId: input.sourceUpdateId,
  category: "ADDITIONAL",
  amountMinor: toMinorUnits(input.chargesRequired),
  currency: "INR",
  purpose: "Certificate processing charge",
});

export const planChargeInput = (input: {
  userId: string;
  planId: string;
  planName: string;
  price: Decimal.Value;
}): CreateChargeInput => ({
  userId: input.userId,
  target: { type: "PLAN", planId: input.planId },
  category: "PLAN",
  amountMinor: toMinorUnits(input.price),
  currency: "INR",
  purpose: `Purchase of plan: ${input.planName}`,
});
