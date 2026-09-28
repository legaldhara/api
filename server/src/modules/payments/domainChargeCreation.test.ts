import { describe, expect, it } from "vitest";
import {
  applicationChargeInput,
  certificateChargeInput,
  planChargeInput,
} from "./domainChargeCreation";

describe("domain-owned payment charges", () => {
  it("calculates an application charge from service pricing", () => {
    const input = applicationChargeInput({
      userId: "user-1",
      applicationId: "application-1",
      sourceUpdateId: "update-1",
      servicePrice: "1000.00",
      governmentCharges: "250.00",
      category: "INITIAL",
    });

    expect(input).toMatchObject({ amountMinor: 125_000, currency: "INR", sourceUpdateId: "update-1" });
  });

  it("binds a certificate charge to its exact update", () => {
    const input = certificateChargeInput({
      userId: "user-1",
      certificateRequestId: "certificate-1",
      sourceUpdateId: "update-1",
      chargesRequired: "499.50",
    });

    expect(input).toMatchObject({
      target: { type: "CERTIFICATE", certificateRequestId: "certificate-1" },
      sourceUpdateId: "update-1",
      amountMinor: 49_950,
      category: "ADDITIONAL",
    });
  });

  it("uses the stored plan price", () => {
    expect(planChargeInput({ userId: "user-1", planId: "plan-1", planName: "Premium", price: "999" }))
      .toMatchObject({ amountMinor: 99_900, category: "PLAN" });
  });
});
