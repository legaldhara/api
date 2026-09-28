import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

const modelBody = (name: string) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));

  expect(match, `${name} must exist`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("payment integrity schema", () => {
  it("stores charges, attempts, webhook events, refunds, and scheduler leases", () => {
    for (const model of [
      "PaymentCharge",
      "PaymentAttempt",
      "PaymentWebhookEvent",
      "PaymentRefund",
      "ScheduledJobLease",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("removes the ambiguous legacy payment model", () => {
    expect(schema).not.toMatch(/model Payment \{/);
  });

  it("retains payment accounting records when related records are deleted", () => {
    for (const model of ["PaymentCharge", "PaymentAttempt", "PaymentWebhookEvent", "PaymentRefund"]) {
      expect(modelBody(model)).not.toMatch(/onDelete: Cascade/);
    }
  });
});
