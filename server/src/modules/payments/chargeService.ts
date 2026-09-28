import { PaymentChargeRepository, paymentChargeRepository } from "./repository";
import {
  CreateChargeInput,
  PaymentActor,
  PaymentChargeRecord,
  PersistedChargeInput,
} from "./types";

export class PaymentDomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

interface ChargeDependencies {
  repository: PaymentChargeRepository;
  now: () => Date;
}

const dependencies = (overrides: Partial<ChargeDependencies> = {}): ChargeDependencies => ({
  repository: paymentChargeRepository,
  now: () => new Date(),
  ...overrides,
});

const toPersistedCharge = (input: CreateChargeInput): PersistedChargeInput => {
  if (!input.userId.trim()) throw new PaymentDomainError("A charge owner is required", 400, "INVALID_OWNER");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new PaymentDomainError("Charge amount must be a positive integer", 400, "INVALID_AMOUNT");
  }
  if (input.currency !== "INR") throw new PaymentDomainError("Unsupported currency", 400, "INVALID_CURRENCY");

  const purpose = input.purpose.trim();
  if (!purpose || purpose.length > 160) {
    throw new PaymentDomainError("Charge purpose must contain 1 to 160 characters", 400, "INVALID_PURPOSE");
  }

  const persisted: PersistedChargeInput = {
    userId: input.userId,
    targetType: input.target.type,
    applicationId: null,
    certificateRequestId: null,
    planId: null,
    sourceApplicationUpdateId: null,
    sourceCertificateUpdateId: null,
    category: input.category,
    amountMinor: input.amountMinor,
    currency: input.currency,
    purpose,
  };

  if (input.target.type === "APPLICATION") {
    if (!input.target.applicationId.trim()) throw new PaymentDomainError("Application target is required", 400, "INVALID_TARGET");
    persisted.applicationId = input.target.applicationId;
    persisted.sourceApplicationUpdateId = input.sourceUpdateId ?? null;
  } else if (input.target.type === "CERTIFICATE") {
    if (!input.target.certificateRequestId.trim()) throw new PaymentDomainError("Certificate target is required", 400, "INVALID_TARGET");
    persisted.certificateRequestId = input.target.certificateRequestId;
    persisted.sourceCertificateUpdateId = input.sourceUpdateId ?? null;
  } else {
    if (!input.target.planId.trim()) throw new PaymentDomainError("Plan target is required", 400, "INVALID_TARGET");
    persisted.planId = input.target.planId;
  }

  return persisted;
};

export const createCharge = (
  input: CreateChargeInput,
  overrides: Partial<ChargeDependencies> = {},
): Promise<PaymentChargeRecord> => dependencies(overrides).repository.createCharge(toPersistedCharge(input));

export const getOwnedCharge = async (
  input: { chargeId: string; actor: PaymentActor },
  overrides: Partial<ChargeDependencies> = {},
): Promise<PaymentChargeRecord> => {
  const charge = await dependencies(overrides).repository.findCharge(input.chargeId);
  const mayRead = charge && (charge.userId === input.actor.id || input.actor.role !== "USER");
  if (!mayRead) throw new PaymentDomainError("Charge not found", 404, "CHARGE_NOT_FOUND");
  return charge;
};

export const cancelOpenCharge = async (
  input: { chargeId: string; actor: PaymentActor },
  overrides: Partial<ChargeDependencies> = {},
): Promise<void> => {
  const deps = dependencies(overrides);
  await getOwnedCharge(input, deps);
  const cancelled = await deps.repository.cancelOpenCharge(input.chargeId, input.actor.id, deps.now());
  if (!cancelled) throw new PaymentDomainError("Open charge could not be cancelled", 409, "CHARGE_NOT_OPEN");
};
