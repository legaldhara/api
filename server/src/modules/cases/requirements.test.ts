import { describe, expect, it } from "vitest";
import type { CaseRepository, RequestCaseRecord } from "./repository";
import { createCaseService } from "./service";

const admin = { id: "admin-1", role: "ADMIN" as const, ownsCase: false, mfaVerified: true };
const owner = { id: "user-1", role: "USER" as const, ownsCase: true, mfaVerified: false };

const createMemoryRepository = () => {
  const requestCase: RequestCaseRecord = {
    id: "case-1",
    type: "APPLICATION",
    ownerId: owner.id,
    applicationId: "application-1",
    status: "UNDER_REVIEW",
    version: 1,
    openRequirements: 0,
    hasCompletionRecord: false,
  };
  const requirements: any[] = [];
  const assets: any[] = [];
  const events: any[] = [];

  const repository = {
    requirements,
    assets,
    events,
    async transaction<T>(operation: (transaction: CaseRepository) => Promise<T>) {
      return operation(repository as unknown as CaseRepository);
    },
    async loadCase(caseId: string) {
      return requestCase.id === caseId ? requestCase : null;
    },
    async updateStatus(input: any) {
      if (requestCase.version !== input.expectedVersion) return null;
      Object.assign(requestCase, input.changes, { version: requestCase.version + 1 });
      return { ...requestCase };
    },
    async appendEvent(input: any) {
      events.push(input);
      return input;
    },
    async findIdempotentEvent(caseId: string, idempotencyKey: string) {
      return events.find((event) => event.caseId === caseId && event.idempotencyKey === idempotencyKey) ?? null;
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
    async updateRequirement(input: any) {
      const requirement = requirements.find((item) => item.id === input.requirementId);
      Object.assign(requirement, input.changes);
      if (input.changes.status === "FULFILLED") requestCase.openRequirements -= 1;
      return requirement;
    },
    async listRequirementAssets(requirementId: string) {
      return assets.filter((asset) => asset.requirementId === requirementId);
    },
    async createCaseAssets(inputs: any[]) {
      assets.push(...inputs);
      return inputs;
    },
    async createCase() {
      throw new Error("not used");
    },
  };

  return { repository: repository as unknown as CaseRepository, requestCase, requirements, assets, events };
};

const claimOwnedAssets = async (input: { assetIds: string[] }) =>
  input.assetIds.map((assetId) => ({ assetId, url: `https://cdn.test/${assetId}`, publicId: assetId }));

describe("case document requirements", () => {
  it("keeps the case actionable until every requested document label has an owned asset", async () => {
    const memory = createMemoryRepository();
    const service = createCaseService(memory.repository, { claimAssetReferences: claimOwnedAssets });
    const requested = await service.requestDocuments({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "docs-1",
      title: "Identity documents",
      instructions: "Upload readable copies",
      documentLabels: ["PAN", "AADHAAR"],
    });

    expect(requested.case.status).toBe("ACTION_REQUIRED");
    const partial = await service.submitDocuments({
      actor: owner,
      caseId: "case-1",
      requirementId: requested.requirement.id,
      expectedVersion: 2,
      idempotencyKey: "docs-submit-1",
      assets: [{ label: "PAN", assetId: "asset-pan" }],
    });

    expect(partial.requirement.status).toBe("OPEN");
    expect(partial.case.status).toBe("ACTION_REQUIRED");
  });

  it("returns to review after the final open requirement is fulfilled", async () => {
    const memory = createMemoryRepository();
    const service = createCaseService(memory.repository, { claimAssetReferences: claimOwnedAssets });
    const requested = await service.requestDocuments({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "docs-1",
      title: "Identity documents",
      instructions: "Upload readable copies",
      documentLabels: ["PAN", "AADHAAR"],
    });
    await service.submitDocuments({
      actor: owner,
      caseId: "case-1",
      requirementId: requested.requirement.id,
      expectedVersion: 2,
      idempotencyKey: "docs-submit-1",
      assets: [{ label: "PAN", assetId: "asset-pan" }],
    });

    const result = await service.submitDocuments({
      actor: owner,
      caseId: "case-1",
      requirementId: requested.requirement.id,
      expectedVersion: 3,
      idempotencyKey: "docs-submit-2",
      assets: [{ label: "AADHAAR", assetId: "asset-aadhaar" }],
    });

    expect(result.requirement.status).toBe("FULFILLED");
    expect(result.case.status).toBe("UNDER_REVIEW");
    expect(result.events.map((event) => event.type)).toEqual(["DOCUMENTS_SUBMITTED", "REVIEW_STARTED"]);
  });

  it("rejects an asset owned by another user", async () => {
    const memory = createMemoryRepository();
    const service = createCaseService(memory.repository, {
      claimAssetReferences: async () => {
        throw Object.assign(new Error("Uploaded asset belongs to another account"), {
          statusCode: 403,
          code: "ASSET_NOT_OWNED",
        });
      },
    });
    const requested = await service.requestDocuments({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "docs-1",
      title: "Identity documents",
      instructions: "Upload readable copies",
      documentLabels: ["PAN"],
    });

    await expect(
      service.submitDocuments({
        actor: owner,
        caseId: "case-1",
        requirementId: requested.requirement.id,
        expectedVersion: 2,
        idempotencyKey: "docs-submit-1",
        assets: [{ label: "PAN", assetId: "foreign-asset" }],
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "ASSET_NOT_OWNED" });
  });

  it("returns to review when an administrator cancels the final open requirement", async () => {
    const memory = createMemoryRepository();
    const service = createCaseService(memory.repository, { claimAssetReferences: claimOwnedAssets });
    const requested = await service.requestDocuments({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 1,
      idempotencyKey: "docs-1",
      title: "Identity documents",
      instructions: "Upload readable copies",
      documentLabels: ["PAN"],
    });

    const result = await service.cancelRequirement({
      actor: admin,
      caseId: "case-1",
      requirementId: requested.requirement.id,
      expectedVersion: 2,
      idempotencyKey: "cancel-docs-1",
      reason: "No longer needed",
    });

    expect(result.requirement.status).toBe("CANCELLED");
    expect(result.case.status).toBe("UNDER_REVIEW");
    expect(result.events.map((event) => event.type)).toEqual(["REQUIREMENT_CANCELLED", "REVIEW_STARTED"]);
  });

  it("attaches an owned final deliverable as completion evidence", async () => {
    const memory = createMemoryRepository();
    Object.assign(memory.requestCase, { status: "APPROVED", version: 7 });
    const service = createCaseService(memory.repository, { claimAssetReferences: claimOwnedAssets });

    const result = await service.attachDeliverable({
      actor: admin,
      caseId: "case-1",
      expectedVersion: 7,
      idempotencyKey: "deliverable-1",
      assetId: "final-asset",
      label: "Approved filing",
    });

    expect(result.case.hasCompletionRecord).toBe(true);
    expect(memory.assets).toMatchObject([
      { assetId: "final-asset", purpose: "FINAL_DELIVERABLE", label: "Approved filing" },
    ]);
    expect(result.event.type).toBe("DELIVERABLE_ATTACHED");
  });

  it("allows an application completion summary but requires a certificate deliverable", async () => {
    const applicationMemory = createMemoryRepository();
    Object.assign(applicationMemory.requestCase, { status: "APPROVED", version: 5 });
    const applicationService = createCaseService(applicationMemory.repository);

    await expect(
      applicationService.completeCase({
        actor: admin,
        caseId: "case-1",
        expectedVersion: 5,
        idempotencyKey: "complete-application",
        completionSummary: "The filing was accepted and recorded by the authority.",
        completionReference: "ACK-2026-1001",
      }),
    ).resolves.toMatchObject({ case: { status: "COMPLETED" } });

    const certificateMemory = createMemoryRepository();
    Object.assign(certificateMemory.requestCase, {
      type: "CERTIFICATE",
      applicationId: undefined,
      certificateRequestId: "certificate-1",
      status: "APPROVED",
      version: 5,
    });
    const certificateService = createCaseService(certificateMemory.repository);

    await expect(
      certificateService.completeCase({
        actor: admin,
        caseId: "case-1",
        expectedVersion: 5,
        idempotencyKey: "complete-certificate",
        completionSummary: "Certificate prepared.",
        completionReference: "CERT-2026-1001",
      }),
    ).rejects.toMatchObject({ code: "COMPLETION_EVIDENCE_REQUIRED" });
  });
});
