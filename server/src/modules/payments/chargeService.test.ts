import { describe, expect, it } from "vitest";
import { createCharge, getOwnedCharge } from "./chargeService";

const charge = (overrides: Record<string, unknown> = {}) => ({
  id: "charge-1",
  userId: "user-1",
  targetType: "APPLICATION" as const,
  applicationId: "application-1",
  certificateRequestId: null,
  planId: null,
  category: "INITIAL" as const,
  amountMinor: 125_000,
  currency: "INR",
  purpose: "Initial application charge",
  status: "OPEN" as const,
  paidAttemptId: null,
  paidAt: null,
  refundedAt: null,
  cancelledAt: null,
  createdAt: new Date("2026-09-26T00:00:00.000Z"),
  updatedAt: new Date("2026-09-26T00:00:00.000Z"),
  ...overrides,
});

describe("payment charge service", () => {
  it("returns not found when another customer reads the charge", async () => {
    const repository = {
      createCharge: async () => charge(),
      findCharge: async () => charge({ userId: "user-2" }),
      cancelOpenCharge: async () => true,
    };

    await expect(getOwnedCharge({
      chargeId: "charge-1",
      actor: { id: "user-1", role: "USER" },
    }, { repository })).rejects.toMatchObject({ statusCode: 404, code: "CHARGE_NOT_FOUND" });
  });

  it("creates the exact server-calculated amount", async () => {
    let createdInput: Record<string, unknown> | undefined;
    const repository = {
      createCharge: async (input: Record<string, unknown>) => {
        createdInput = input;
        return charge(input);
      },
      findCharge: async () => null,
      cancelOpenCharge: async () => true,
    };

    await createCharge({
      userId: "user-1",
      target: { type: "APPLICATION", applicationId: "application-1" },
      category: "INITIAL",
      amountMinor: 125_000,
      currency: "INR",
      purpose: "Initial application charge",
    }, { repository });

    expect(createdInput).toMatchObject({
      userId: "user-1",
      targetType: "APPLICATION",
      applicationId: "application-1",
      amountMinor: 125_000,
      currency: "INR",
    });
    expect(createdInput).not.toHaveProperty("amount");
  });
});
