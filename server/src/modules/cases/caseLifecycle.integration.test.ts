import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/db";
import { createCaseFixtures, caseService } from "./caseFixtures";
import { serializeLifecycle } from "./serializer";

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === "true";

describe.skipIf(!databaseTestsEnabled)("shared request lifecycle integration", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("removes legacy lifecycle tables and columns", async () => {
    const tables = await prisma.$queryRaw<Array<{ application_updates: string | null; certificate_updates: string | null }>>`
      SELECT to_regclass('"ApplicationUpdate"')::text AS application_updates,
             to_regclass('"CertificateUpdate"')::text AS certificate_updates
    `;
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'Application' AND column_name = 'applicationStatus')
          OR (table_name = 'CertificateRequest' AND column_name IN ('status', 'pendingPayment', 'docRequired', 'isResolved', 'resolvedAt')))
    `;

    expect(tables[0]).toEqual({ application_updates: null, certificate_updates: null });
    expect(columns).toEqual([]);
  });

  it.each(["APPLICATION", "CERTIFICATE"] as const)("completes the %s lifecycle", async (type) => {
    const fixtures = createCaseFixtures();
    cleanup = fixtures.cleanup;
    const owner = await fixtures.createActor("USER");
    const admin = await fixtures.createActor("COADMIN");
    const masterAdmin = await fixtures.createActor("ADMIN");
    const created = await fixtures.createRequest(type, owner);
    const reviewed = await caseService.startReview({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: created.case.version,
      idempotencyKey: `review-${fixtures.suffix}`,
    });
    const documents = await caseService.requestDocuments({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: reviewed.case.version,
      idempotencyKey: `documents-${fixtures.suffix}`,
      title: "Identity document",
      instructions: "Upload a readable identity document",
      documentLabels: ["IDENTITY"],
    });
    const message = await caseService.postMessage({
      actor: owner,
      caseId: created.case.id,
      expectedVersion: documents.case.version,
      idempotencyKey: `message-${fixtures.suffix}`,
      message: "Can I upload this tomorrow?",
    });
    const identityAsset = await fixtures.createAsset(owner.id, `identity-${type}`);
    const submitted = await caseService.submitDocuments({
      actor: owner,
      caseId: created.case.id,
      requirementId: documents.requirement.id,
      expectedVersion: message.case.version,
      idempotencyKey: `submit-${fixtures.suffix}`,
      assets: [{ label: "IDENTITY", assetId: identityAsset.id }],
    });
    const payment = await caseService.requestPayment({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: submitted.case.version,
      idempotencyKey: `payment-${fixtures.suffix}`,
      category: "ADDITIONAL",
      amountMinor: 10_000,
      purpose: "Integration filing fee",
    });
    const settled = await caseService.recordPaymentSettlement({
      caseId: created.case.id,
      requirementId: payment.requirement.id,
      chargeId: payment.charge.id,
      attemptId: randomAttemptId(fixtures.suffix),
    });
    const approved = await caseService.approveCase({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: settled.case.version,
      idempotencyKey: `approve-${fixtures.suffix}`,
    });
    const finalAsset = await fixtures.createAsset(owner.id, `final-${type}`);
    const delivered = await caseService.attachDeliverable({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: approved.case.version,
      idempotencyKey: `deliver-${fixtures.suffix}`,
      assetId: finalAsset.id,
      label: "Final deliverable",
    });
    const completed = await caseService.completeCase({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: delivered.case.version,
      idempotencyKey: `complete-${fixtures.suffix}`,
    });
    const closed = await caseService.closeCase({
      actor: masterAdmin,
      caseId: created.case.id,
      expectedVersion: completed.case.version,
      idempotencyKey: `close-${fixtures.suffix}`,
    });

    const lifecycle = await serializeLifecycle(closed.case.id, owner);
    expect(lifecycle.case.status).toBe("CLOSED");
    expect(lifecycle.timeline.map((event) => event.type)).toEqual(expect.arrayContaining([
      "CASE_SUBMITTED", "REVIEW_STARTED", "DOCUMENTS_REQUESTED", "USER_MESSAGE",
      "DOCUMENTS_SUBMITTED", "PAYMENT_REQUESTED", "PAYMENT_CONFIRMED",
      "CASE_APPROVED", "DELIVERABLE_ATTACHED", "CASE_COMPLETED", "CASE_CLOSED",
    ]));
  });

  it("hides a case from an unrelated customer", async () => {
    const fixtures = createCaseFixtures();
    cleanup = fixtures.cleanup;
    const owner = await fixtures.createActor("USER");
    const stranger = await fixtures.createActor("USER");
    const created = await fixtures.createRequest("APPLICATION", owner);

    await expect(serializeLifecycle(created.case.id, stranger)).rejects.toMatchObject({
      statusCode: 404,
      code: "CASE_NOT_FOUND",
    });
  });
});

const randomAttemptId = (suffix: string) => {
  const normalized = suffix.replace(/-/g, "").slice(0, 12);
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-4000-8000-000000000001`;
};
