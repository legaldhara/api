import { describe, expect, it, vi } from "vitest";
import { createPaymentChargeRepository } from "./repository";
import { PersistedChargeInput } from "./types";

describe("payment charge repository", () => {
  it("uses the supplied transaction client for charge creation", async () => {
    const createdCharge = { id: "charge-1" };
    const create = vi.fn().mockResolvedValue(createdCharge);
    const client = {
      paymentCharge: {
        create,
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    const input: PersistedChargeInput = {
      userId: "user-1",
      targetType: "APPLICATION",
      applicationId: "application-1",
      certificateRequestId: null,
      planId: null,
      sourceApplicationUpdateId: "update-1",
      sourceCertificateUpdateId: null,
      category: "INITIAL",
      amountMinor: 125_000,
      currency: "INR",
      purpose: "Initial application charge",
    };

    const repository = createPaymentChargeRepository(client as never);
    await expect(repository.createCharge(input)).resolves.toBe(createdCharge);
    expect(create).toHaveBeenCalledWith({ data: input });
  });
});
