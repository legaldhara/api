import { describe, expect, it } from "vitest";
import type { CaseRepository, RequestCaseRecord } from "./repository";
import { createCaseService } from "./service";

const admin = { id: "admin-1", role: "ADMIN" as const, ownsCase: false, mfaVerified: true };

const createPaymentRepository = () => {
  const requestCase: RequestCaseRecord = {
    id: "case-1",
    type: "APPLICATION",
    ownerId: "user-1",
    applicationId: "application-1",
    status: "UNDER_REVIEW",
    version: 1,
    openRequirements: 0,
    hasCompletionRecord: false,
  };
  const requirements: any[] = [];
  const events: any[] = [];
  const charges: any[] = [];
  const repository: any = {
    async transaction<T>(operation: (transaction: CaseRepository) => Promise<T>) {
      return operation(repository as CaseRepository);
    },
    async loadCase(caseId: string) {
      return caseId === requestCase.id ? requestCase : null;
    },
    async updateStatus(input: any) {
      if (requestCase.version !== input.expectedVersion) return null;
      Object.assign(requestCase, input.changes, { version: requestCase.version + 1 });
      return { ...requestCase };
    },
    async findIdempotentEvent(caseId: string, idempotencyKey: string) {
      return events.find((event) => event.caseId === caseId && event.idempotencyKey === idempotencyKey) ?? null;
    },
    async appendEvent(input: any) {
      events.push(input);
      return input;
    },
    async findOpenPaymentRequirement(caseId: string) {
      return requirements.find(
        (requirement) => requirement.caseId === caseId && requirement.type === "PAYMENT" && requirement.status === "OPEN",
      ) ?? null;
    },
    async createPaymentCharge(input: any) {
      const charge = {
        id: `charge-${charges.length + 1}`,
        ...input,
        status: "OPEN",
        paidAttemptId: null,
        paidAt: null,
        refundedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      charges.push(charge);
      return charge;
    },
    async createRequirement(input: any) {
      const requirement = { ...input, status: "OPEN" };
      requirements.push(requirement);
      requestCase.openRequirements += 1;
      return requirement;
    },
    async loadRequirement(requirementId: string) {
      return requirements.find((requirement) => requirement.id === requirementId) ?? null;
    },
    async findRequirementByPaymentCharge(chargeId: string) {
      return requirements.find((requirement) => requirement.paymentChargeId === chargeId) ?? null;
    },
    async updateRequirement(input: any) {
      const requirement = requirements.find((item) => item.id === input.requirementId);
      Object.assign(requirement, input.changes);
      if (input.changes.status === "FULFILLED") requestCase.openRequirements -= 1;
      return requirement;
    },
  };
  return { repository: repository as CaseRepository, requestCase, requirements, events, charges };
};

describe("case payment requirements", () => {
  it("creates one open requirement linked to a server-derived charge", async () => {
    const memory = createPaymentRepository();
    const service = createCaseService(memory.repository);
    const result = await service.requestPayment({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "payment-request-1",
      category: "ADDITIONAL",
      amountMinor: 125_000,
      purpose: "Government filing fee",
    });

    expect(result.requirement).toMatchObject({ type: "PAYMENT", status: "OPEN" });
    expect(result.charge).toMatchObject({ amountMinor: 125_000, status: "OPEN" });
    expect(result.case.status).toBe("ACTION_REQUIRED");
  });

  it("rejects a second open payment requirement", async () => {
    const memory = createPaymentRepository();
    const service = createCaseService(memory.repository);
    await service.requestPayment({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "payment-request-1",
      category: "ADDITIONAL",
      amountMinor: 125_000,
      purpose: "Government filing fee",
    });

    await expect(
      service.requestPayment({
        actor: admin,
        caseId: "case-1",
        expectedVersion: 2,
        idempotencyKey: "payment-request-2",
        category: "CORRECTION",
        amountMinor: 50_000,
        purpose: "Correction fee",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "OPEN_PAYMENT_REQUIREMENT_EXISTS" });
  });

  it("fulfils payment only through settlement and returns to review", async () => {
    const memory = createPaymentRepository();
    const service = createCaseService(memory.repository);
    const requested = await service.requestPayment({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "payment-request-1",
      category: "ADDITIONAL",
      amountMinor: 125_000,
      purpose: "Government filing fee",
    });

    const result = await service.recordPaymentSettlement({
      caseId: "case-1",
      requirementId: requested.requirement.id,
      chargeId: requested.charge.id,
      attemptId: "attempt-1",
    });

    expect(result.requirement.status).toBe("FULFILLED");
    expect(result.case.status).toBe("UNDER_REVIEW");
    expect(result.event.type).toBe("PAYMENT_CONFIRMED");
  });

  it("returns the original result for a duplicate settlement attempt", async () => {
    const memory = createPaymentRepository();
    const service = createCaseService(memory.repository);
    const requested = await service.requestPayment({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "payment-request-1",
      category: "ADDITIONAL",
      amountMinor: 125_000,
      purpose: "Government filing fee",
    });
    const settlement = {
      caseId: "case-1",
      requirementId: requested.requirement.id,
      chargeId: requested.charge.id,
      attemptId: "attempt-1",
    };

    const first = await service.recordPaymentSettlement(settlement);
    const second = await service.recordPaymentSettlement(settlement);

    expect(second.event.id).toBe(first.event.id);
    expect(memory.events.filter((event) => event.type === "PAYMENT_CONFIRMED")).toHaveLength(1);
  });
});
