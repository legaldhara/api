import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("shared request lifecycle schema", () => {
  it("defines one lifecycle authority for applications and certificates", () => {
    expect(schema).toContain("model RequestCase {");
    expect(schema).toContain("applicationId          String?              @unique @db.Uuid");
    expect(schema).toContain("certificateRequestId   String?              @unique @db.Uuid");
    expect(schema).toContain("version                Int                  @default(0)");
    expect(schema).toContain("enum RequestCaseStatus {");
    for (const status of [
      "SUBMITTED",
      "UNDER_REVIEW",
      "ACTION_REQUIRED",
      "APPROVED",
      "REJECTED",
      "COMPLETED",
      "CLOSED",
    ]) {
      expect(schema).toContain(status);
    }
  });

  it("stores immutable events, requirements, assets, and email jobs", () => {
    for (const model of ["CaseEvent", "CaseRequirement", "CaseAsset", "NotificationOutbox"]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).toContain("@@unique([caseId, idempotencyKey])");
    expect(schema).toContain("@@unique([eventId, recipientId, channel, templateKey])");
  });

  it("provides a dedicated uploaded-asset context for cases", () => {
    expect(schema).toMatch(/enum AssetContext \{[\s\S]*\bCASE\b/);
  });

  it("removes duplicate lifecycle storage", () => {
    expect(schema).not.toContain("model ApplicationUpdate {");
    expect(schema).not.toContain("model CertificateUpdate {");
    expect(schema).not.toContain("applicationStatus ApplicationStatus");
    expect(schema).not.toContain("status         CertificateRequestStatus");
    expect(schema).not.toContain("pendingPayment Boolean");
    expect(schema).not.toContain("pendingDocs");
    expect(schema).not.toContain("docRequired    Boolean");
  });
});
