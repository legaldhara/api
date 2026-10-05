import { randomUUID } from "node:crypto";
import type {
  CaseAssetRecord,
  CaseEventRecord,
  CaseEventType,
  CaseRepository,
  CaseRequirementRecord,
  RequestCaseRecord,
  RequestCaseType,
} from "./repository";
import { assertCaseAction } from "./transitionPolicy";
import { CaseDomainError, type CaseAction, type CaseActor, type RequestCaseStatus } from "./types";
import { claimAssetReferences as claimUploadedAssetReferences } from "../../services/uploadedAsset";
import { caseChargeInput } from "../payments/domainChargeCreation";
import type { PaymentCategory, PaymentChargeRecord } from "../payments/types";
import { notificationForCaseEvent } from "./notificationPolicy";

type EventView = Omit<CaseEventRecord, "result">;

export interface CaseCommandResult {
  case: RequestCaseRecord;
  event: EventView;
}

interface CommandBase {
  actor: CaseActor;
  caseId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

interface CreateCaseCommand {
  type: RequestCaseType;
  ownerId: string;
  applicationId?: string;
  certificateRequestId?: string;
  idempotencyKey: string;
}

interface MessageCommand extends CommandBase {
  message: string;
}

interface RequestDocumentsCommand extends CommandBase {
  title: string;
  instructions: string;
  documentLabels: string[];
}

interface SubmitDocumentsCommand extends CommandBase {
  requirementId: string;
  assets: Array<{ label: string; assetId: string }>;
}

interface CancelRequirementCommand extends CommandBase {
  requirementId: string;
  reason: string;
}

interface AttachDeliverableCommand extends CommandBase {
  assetId: string;
  label?: string;
}

interface CompleteCaseCommand extends CommandBase {
  completionSummary?: string;
  completionReference?: string;
}

interface RejectCaseCommand extends CommandBase {
  reason: string;
}

interface RequestPaymentCommand extends CommandBase {
  category: Exclude<PaymentCategory, "PLAN">;
  amountMinor: number;
  purpose: string;
}

interface PaymentSettlementInput {
  caseId: string;
  requirementId: string;
  chargeId: string;
  attemptId: string;
}

export interface PaymentRequirementResult extends RequirementResult {
  charge: PaymentChargeRecord;
}

export interface RequirementResult {
  case: RequestCaseRecord;
  requirement: CaseRequirementRecord;
  event: EventView;
  events: EventView[];
}

interface CaseServiceDependencies {
  claimAssetReferences: typeof claimUploadedAssetReferences;
  now: () => Date;
  id: () => string;
  maximumPaymentAmountMinor: number;
}

interface TransitionDefinition {
  action: CaseAction;
  eventType: CaseEventType;
  status?: RequestCaseStatus;
  timestamp?: "approvedAt" | "rejectedAt" | "completedAt" | "closedAt";
}

export const createCaseService = (
  repository: CaseRepository,
  overrides: Partial<CaseServiceDependencies> = {},
) => {
  const dependencies: CaseServiceDependencies = {
    claimAssetReferences: claimUploadedAssetReferences,
    now: () => new Date(),
    id: randomUUID,
    maximumPaymentAmountMinor: Number(process.env.MAX_PAYMENT_AMOUNT_MINOR) || 100_000_000,
    ...overrides,
  };
  const execute = async (
    input: CommandBase,
    definition: TransitionDefinition,
    message?: string,
    options: {
      applicationCompletionEvidence?: { summary: string; reference: string };
    } = {},
  ): Promise<CaseCommandResult> =>
    repository.transaction(async (transaction) => {
      const duplicate = await transaction.findIdempotentEvent(input.caseId, input.idempotencyKey);
      if (duplicate) return duplicate.result as CaseCommandResult;

      const requestCase = await transaction.loadCase(input.caseId);
      if (!requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
      if (requestCase.version !== input.expectedVersion) {
        throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
      }

      const acceptsSummary = requestCase.type === "APPLICATION" && Boolean(options.applicationCompletionEvidence);
      assertCaseAction(
        acceptsSummary ? { ...requestCase, hasCompletionRecord: true } : requestCase,
        input.actor,
        definition.action,
      );
      const changes: Parameters<CaseRepository["updateStatus"]>[0]["changes"] = {
        status: definition.status ?? requestCase.status,
      };
      if (acceptsSummary) changes.hasCompletionRecord = true;
      if (definition.timestamp) changes[definition.timestamp] = dependencies.now();

      const updatedCase = await transaction.updateStatus({
        caseId: input.caseId,
        expectedVersion: input.expectedVersion,
        changes,
      });
      if (!updatedCase) {
        throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
      }

      const event: EventView = {
        id: dependencies.id(),
        caseId: input.caseId,
        actorId: input.actor.id,
        actorRoleSnapshot: input.actor.role,
        type: definition.eventType,
        message,
        previousStatus: requestCase.status,
        newStatus: updatedCase.status,
        idempotencyKey: input.idempotencyKey,
        metadata: acceptsSummary ? { completion: options.applicationCompletionEvidence } : undefined,
      };
      const result: CaseCommandResult = { case: updatedCase, event };
      await appendEvent(transaction, event, result, updatedCase);
      return result;
    });

  const transition = (definition: TransitionDefinition) => (input: CommandBase) => execute(input, definition);

  const loadCommandCase = async (transaction: CaseRepository, input: CommandBase) => {
    const duplicate = await transaction.findIdempotentEvent(input.caseId, input.idempotencyKey);
    if (duplicate) return { duplicate: duplicate.result, requestCase: null };
    const requestCase = await transaction.loadCase(input.caseId);
    if (!requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
    if (requestCase.version !== input.expectedVersion) {
      throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
    }
    return { duplicate: null, requestCase };
  };

  const appendEvent = async (
    transaction: CaseRepository,
    event: EventView,
    result: unknown,
    requestCase: RequestCaseRecord,
  ) => {
    await transaction.appendEvent({ ...event, result });
    const notification = notificationForCaseEvent({
      id: event.id,
      type: event.type,
      caseId: event.caseId,
      caseType: requestCase.type,
      targetId: requestCase.applicationId ?? requestCase.certificateRequestId ?? requestCase.id,
      ownerId: requestCase.ownerId,
    });
    if (notification && transaction.createCaseNotification) {
      await transaction.createCaseNotification({
        caseId: event.caseId,
        eventId: event.id,
        ...notification,
      });
    }
  };

  const normalizeText = (value: string, field: string, maximum: number) => {
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum) {
      throw new CaseDomainError(`${field} is invalid`, 400, "INVALID_REQUIREMENT");
    }
    return normalized;
  };

  const normalizeLabels = (labels: string[]) => {
    if (labels.length < 1 || labels.length > 20) {
      throw new CaseDomainError("Provide between one and twenty document labels", 400, "INVALID_DOCUMENT_LABELS");
    }
    const normalized = labels.map((label) => normalizeText(label, "Document label", 80));
    if (new Set(normalized).size !== normalized.length) {
      throw new CaseDomainError("Document labels must be unique", 400, "INVALID_DOCUMENT_LABELS");
    }
    return normalized;
  };

  return {
    createCase: (input: CreateCaseCommand): Promise<CaseCommandResult> =>
      repository.transaction(async (transaction) => {
        const hasApplication = Boolean(input.applicationId);
        const hasCertificate = Boolean(input.certificateRequestId);
        if (hasApplication === hasCertificate) {
          throw new CaseDomainError("Exactly one case target is required", 400, "INVALID_CASE_TARGET");
        }
        if (
          (input.type === "APPLICATION" && !hasApplication) ||
          (input.type === "CERTIFICATE" && !hasCertificate)
        ) {
          throw new CaseDomainError("Case type does not match its target", 400, "INVALID_CASE_TARGET");
        }

        const requestCase = await transaction.createCase({
          id: dependencies.id(),
          type: input.type,
          ownerId: input.ownerId,
          applicationId: input.applicationId,
          certificateRequestId: input.certificateRequestId,
        });
        const event: EventView = {
          id: dependencies.id(),
          caseId: requestCase.id,
          type: "CASE_SUBMITTED",
          previousStatus: "SUBMITTED",
          newStatus: "SUBMITTED",
          idempotencyKey: input.idempotencyKey,
        };
        const result: CaseCommandResult = { case: requestCase, event };
        await appendEvent(transaction, event, result, requestCase);
        return result;
      }),
    startReview: transition({ action: "START_REVIEW", eventType: "REVIEW_STARTED", status: "UNDER_REVIEW" }),
    postMessage: (input: MessageCommand): Promise<CaseCommandResult> =>
      execute(
        input,
        {
          action: "POST_MESSAGE",
          eventType: input.actor.role === "USER" ? "USER_MESSAGE" : "ADMIN_MESSAGE",
        },
        input.message,
      ),
    requestDocuments: (input: RequestDocumentsCommand): Promise<RequirementResult> =>
      repository.transaction(async (transaction) => {
        const loaded = await loadCommandCase(transaction, input);
        if (loaded.duplicate) return loaded.duplicate as RequirementResult;
        const requestCase = loaded.requestCase!;
        assertCaseAction(requestCase, input.actor, "REQUEST_DOCUMENTS");

        const requirement = await transaction.createRequirement({
          id: dependencies.id(),
          caseId: input.caseId,
          type: "DOCUMENT",
          createdBy: input.actor.id,
          title: normalizeText(input.title, "Requirement title", 120),
          instructions: normalizeText(input.instructions, "Requirement instructions", 2_000),
          documentLabels: normalizeLabels(input.documentLabels),
        });
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          changes: { status: "ACTION_REQUIRED" },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
        }

        const event: EventView = {
          id: dependencies.id(),
          caseId: input.caseId,
          actorId: input.actor.id,
          actorRoleSnapshot: input.actor.role,
          type: "DOCUMENTS_REQUESTED",
          previousStatus: requestCase.status,
          newStatus: updatedCase.status,
          idempotencyKey: input.idempotencyKey,
          requirementId: requirement.id,
        };
        const result: RequirementResult = { case: updatedCase, requirement, event, events: [event] };
        await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    requestPayment: (input: RequestPaymentCommand): Promise<PaymentRequirementResult> =>
      repository.transaction(async (transaction) => {
        const loaded = await loadCommandCase(transaction, input);
        if (loaded.duplicate) return loaded.duplicate as PaymentRequirementResult;
        const requestCase = loaded.requestCase!;
        assertCaseAction(requestCase, input.actor, "REQUEST_PAYMENT");
        if (
          !Number.isSafeInteger(input.amountMinor) ||
          input.amountMinor <= 0 ||
          input.amountMinor > dependencies.maximumPaymentAmountMinor
        ) {
          throw new CaseDomainError("Payment amount is outside the allowed range", 400, "INVALID_PAYMENT_AMOUNT");
        }
        if (await transaction.findOpenPaymentRequirement(input.caseId)) {
          throw new CaseDomainError(
            "This case already has an open payment requirement",
            409,
            "OPEN_PAYMENT_REQUIREMENT_EXISTS",
          );
        }

        const purpose = normalizeText(input.purpose, "Payment purpose", 160);
        const charge = await transaction.createPaymentCharge(caseChargeInput({
          userId: requestCase.ownerId,
          type: requestCase.type,
          applicationId: requestCase.applicationId,
          certificateRequestId: requestCase.certificateRequestId,
          category: input.category,
          amountMinor: input.amountMinor,
          purpose,
        }));
        const requirement = await transaction.createRequirement({
          id: dependencies.id(),
          caseId: input.caseId,
          type: "PAYMENT",
          createdBy: input.actor.id,
          title: "Payment required",
          instructions: purpose,
          documentLabels: [],
          paymentChargeId: charge.id,
        });
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          changes: { status: "ACTION_REQUIRED" },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
        }

        const event: EventView = {
          id: dependencies.id(),
          caseId: input.caseId,
          actorId: input.actor.id,
          actorRoleSnapshot: input.actor.role,
          type: "PAYMENT_REQUESTED",
          previousStatus: requestCase.status,
          newStatus: updatedCase.status,
          idempotencyKey: input.idempotencyKey,
          requirementId: requirement.id,
          paymentChargeId: charge.id,
        };
        const result: PaymentRequirementResult = {
          case: updatedCase,
          requirement,
          charge,
          event,
          events: [event],
        };
        await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    recordPaymentSettlement: (input: PaymentSettlementInput): Promise<RequirementResult> =>
      repository.transaction(async (transaction) => {
        const idempotencyKey = `payment:${input.attemptId}`;
        const duplicate = await transaction.findIdempotentEvent(input.caseId, idempotencyKey);
        if (duplicate) return duplicate.result as RequirementResult;

        const requestCase = await transaction.loadCase(input.caseId);
        if (!requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
        const requirement = await transaction.findRequirementByPaymentCharge(input.chargeId);
        if (
          !requirement ||
          requirement.id !== input.requirementId ||
          requirement.caseId !== input.caseId ||
          requirement.type !== "PAYMENT"
        ) {
          throw new CaseDomainError("Payment requirement not found", 409, "PAYMENT_REQUIREMENT_NOT_FOUND");
        }
        if (requirement.status !== "OPEN") {
          throw new CaseDomainError("Payment requirement is not open", 409, "REQUIREMENT_NOT_OPEN");
        }

        const openRequirementsBeforeSettlement = requestCase.openRequirements;
        const updatedRequirement = await transaction.updateRequirement({
          requirementId: requirement.id,
          changes: { status: "FULFILLED", fulfilledAt: dependencies.now() },
        });
        const shouldResumeReview = openRequirementsBeforeSettlement === 1;
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: requestCase.version,
          changes: { status: shouldResumeReview ? "UNDER_REVIEW" : "ACTION_REQUIRED" },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; settlement must be retried", 409, "CASE_VERSION_CONFLICT");
        }

        const event: EventView = {
          id: dependencies.id(),
          caseId: input.caseId,
          type: "PAYMENT_CONFIRMED",
          previousStatus: requestCase.status,
          newStatus: updatedCase.status,
          idempotencyKey,
          requirementId: requirement.id,
          paymentChargeId: input.chargeId,
          metadata: { attemptId: input.attemptId },
        };
        const result: RequirementResult = {
          case: updatedCase,
          requirement: updatedRequirement,
          event,
          events: [event],
        };
        await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    submitDocuments: (input: SubmitDocumentsCommand): Promise<RequirementResult> =>
      repository.transaction(async (transaction) => {
        const loaded = await loadCommandCase(transaction, input);
        if (loaded.duplicate) return loaded.duplicate as RequirementResult;
        const requestCase = loaded.requestCase!;
        if (input.actor.role !== "USER" || !input.actor.ownsCase) {
          throw new CaseDomainError("Only the case owner can submit documents", 403, "CASE_FORBIDDEN");
        }
        if (requestCase.status !== "ACTION_REQUIRED") {
          throw new CaseDomainError("Documents are not currently required", 409, "CASE_ACTION_NOT_AVAILABLE");
        }

        const requirement = await transaction.loadRequirement(input.requirementId);
        if (!requirement || requirement.caseId !== input.caseId || requirement.type !== "DOCUMENT") {
          throw new CaseDomainError("Document requirement not found", 404, "REQUIREMENT_NOT_FOUND");
        }
        if (requirement.status !== "OPEN") {
          throw new CaseDomainError("Document requirement is not open", 409, "REQUIREMENT_NOT_OPEN");
        }
        if (input.assets.length < 1 || input.assets.length > 20) {
          throw new CaseDomainError("Provide between one and twenty assets", 400, "INVALID_DOCUMENT_ASSETS");
        }

        const submittedLabels = input.assets.map((asset) => normalizeText(asset.label, "Document label", 80));
        if (new Set(submittedLabels).size !== submittedLabels.length) {
          throw new CaseDomainError("Submitted document labels must be unique", 400, "INVALID_DOCUMENT_ASSETS");
        }
        if (submittedLabels.some((label) => !requirement.documentLabels.includes(label))) {
          throw new CaseDomainError("A document label was not requested", 400, "INVALID_DOCUMENT_ASSETS");
        }

        const existingAssets = await transaction.listRequirementAssets(requirement.id);
        const existingLabels = new Set(existingAssets.map((asset) => asset.label));
        if (submittedLabels.some((label) => existingLabels.has(label))) {
          throw new CaseDomainError("A document label was already submitted", 409, "DOCUMENT_ALREADY_SUBMITTED");
        }

        await dependencies.claimAssetReferences({
          assetIds: input.assets.map((asset) => asset.assetId),
          actor: input.actor,
          context: "CASE",
          referenceId: requirement.id,
        });

        const submissionEventId = dependencies.id();
        const caseAssets: CaseAssetRecord[] = input.assets.map((asset) => ({
          id: dependencies.id(),
          caseId: input.caseId,
          assetId: asset.assetId,
          requirementId: requirement.id,
          eventId: submissionEventId,
          purpose: "REQUIREMENT_DOCUMENT",
          label: asset.label.trim(),
        }));
        await transaction.createCaseAssets(caseAssets);

        const fulfilled = requirement.documentLabels.every(
          (label) => existingLabels.has(label) || submittedLabels.includes(label),
        );
        const openRequirementsBeforeFulfilment = requestCase.openRequirements;
        const updatedRequirement = fulfilled
          ? await transaction.updateRequirement({
              requirementId: requirement.id,
              changes: {
                status: "FULFILLED",
                fulfilledBy: input.actor.id,
                fulfilledAt: dependencies.now(),
              },
            })
          : requirement;
        const shouldResumeReview = fulfilled && openRequirementsBeforeFulfilment === 1;
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          changes: { status: shouldResumeReview ? "UNDER_REVIEW" : "ACTION_REQUIRED" },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
        }

        const submittedEvent: EventView = {
          id: submissionEventId,
          caseId: input.caseId,
          actorId: input.actor.id,
          actorRoleSnapshot: input.actor.role,
          type: "DOCUMENTS_SUBMITTED",
          previousStatus: requestCase.status,
          newStatus: updatedCase.status,
          idempotencyKey: input.idempotencyKey,
          requirementId: requirement.id,
        };
        const events: EventView[] = [submittedEvent];
        if (shouldResumeReview) {
          events.push({
            id: dependencies.id(),
            caseId: input.caseId,
            type: "REVIEW_STARTED",
            previousStatus: "ACTION_REQUIRED",
            newStatus: "UNDER_REVIEW",
            idempotencyKey: `${input.idempotencyKey}:review`,
            requirementId: requirement.id,
          });
        }
        const result: RequirementResult = {
          case: updatedCase,
          requirement: updatedRequirement,
          event: submittedEvent,
          events,
        };
        for (const event of events) await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    cancelRequirement: (input: CancelRequirementCommand): Promise<RequirementResult> =>
      repository.transaction(async (transaction) => {
        const loaded = await loadCommandCase(transaction, input);
        if (loaded.duplicate) return loaded.duplicate as RequirementResult;
        const requestCase = loaded.requestCase!;
        assertCaseAction(requestCase, input.actor, "CANCEL_REQUIREMENT");

        const requirement = await transaction.loadRequirement(input.requirementId);
        if (!requirement || requirement.caseId !== input.caseId) {
          throw new CaseDomainError("Requirement not found", 404, "REQUIREMENT_NOT_FOUND");
        }
        if (requirement.status !== "OPEN") {
          throw new CaseDomainError("Requirement is not open", 409, "REQUIREMENT_NOT_OPEN");
        }

        const openRequirementsBeforeCancellation = requestCase.openRequirements;
        const updatedRequirement = await transaction.updateRequirement({
          requirementId: requirement.id,
          changes: {
            status: "CANCELLED",
            cancelledBy: input.actor.id,
            cancelledAt: dependencies.now(),
            cancellationReason: normalizeText(input.reason, "Cancellation reason", 500),
          },
        });
        const shouldResumeReview = openRequirementsBeforeCancellation === 1;
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          changes: { status: shouldResumeReview ? "UNDER_REVIEW" : "ACTION_REQUIRED" },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
        }

        const cancelledEvent: EventView = {
          id: dependencies.id(),
          caseId: input.caseId,
          actorId: input.actor.id,
          actorRoleSnapshot: input.actor.role,
          type: "REQUIREMENT_CANCELLED",
          previousStatus: requestCase.status,
          newStatus: updatedCase.status,
          idempotencyKey: input.idempotencyKey,
          requirementId: requirement.id,
        };
        const events: EventView[] = [cancelledEvent];
        if (shouldResumeReview) {
          events.push({
            id: dependencies.id(),
            caseId: input.caseId,
            actorId: input.actor.id,
            actorRoleSnapshot: input.actor.role,
            type: "REVIEW_STARTED",
            previousStatus: "ACTION_REQUIRED",
            newStatus: "UNDER_REVIEW",
            idempotencyKey: `${input.idempotencyKey}:review`,
            requirementId: requirement.id,
          });
        }
        const result: RequirementResult = {
          case: updatedCase,
          requirement: updatedRequirement,
          event: cancelledEvent,
          events,
        };
        for (const event of events) await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    attachDeliverable: (input: AttachDeliverableCommand): Promise<CaseCommandResult> =>
      repository.transaction(async (transaction) => {
        const loaded = await loadCommandCase(transaction, input);
        if (loaded.duplicate) return loaded.duplicate as CaseCommandResult;
        const requestCase = loaded.requestCase!;
        assertCaseAction(requestCase, input.actor, "ATTACH_DELIVERABLE");

        await dependencies.claimAssetReferences({
          assetIds: [input.assetId],
          actor: input.actor,
          context: "CASE",
          referenceId: input.caseId,
        });
        const event: EventView = {
          id: dependencies.id(),
          caseId: input.caseId,
          actorId: input.actor.id,
          actorRoleSnapshot: input.actor.role,
          type: "DELIVERABLE_ATTACHED",
          previousStatus: requestCase.status,
          newStatus: requestCase.status,
          idempotencyKey: input.idempotencyKey,
        };
        await transaction.createCaseAssets([
          {
            id: dependencies.id(),
            caseId: input.caseId,
            assetId: input.assetId,
            eventId: event.id,
            purpose: "FINAL_DELIVERABLE",
            label: input.label ? normalizeText(input.label, "Deliverable label", 120) : undefined,
          },
        ]);
        const updatedCase = await transaction.updateStatus({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          changes: { status: requestCase.status, hasCompletionRecord: true },
        });
        if (!updatedCase) {
          throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
        }
        const result: CaseCommandResult = { case: updatedCase, event };
        await appendEvent(transaction, event, result, updatedCase);
        return result;
      }),
    approveCase: transition({
      action: "APPROVE",
      eventType: "CASE_APPROVED",
      status: "APPROVED",
      timestamp: "approvedAt",
    }),
    rejectCase: (input: RejectCaseCommand): Promise<CaseCommandResult> =>
      execute(
        input,
        {
          action: "REJECT",
          eventType: "CASE_REJECTED",
          status: "REJECTED",
          timestamp: "rejectedAt",
        },
        normalizeText(input.reason, "Rejection reason", 1_000),
      ),
    completeCase: (input: CompleteCaseCommand): Promise<CaseCommandResult> => {
      const hasSummaryInput = input.completionSummary !== undefined || input.completionReference !== undefined;
      let completionEvidence: { summary: string; reference: string } | undefined;
      if (hasSummaryInput) {
        const summary = normalizeText(input.completionSummary ?? "", "Completion summary", 2_000);
        const reference = normalizeText(input.completionReference ?? "", "Completion reference", 200);
        if (summary.length < 20) {
          throw new CaseDomainError("Completion summary is too short", 400, "INVALID_COMPLETION_SUMMARY");
        }
        completionEvidence = { summary, reference };
      }

      return execute(
        input,
        {
          action: "COMPLETE",
          eventType: "CASE_COMPLETED",
          status: "COMPLETED",
          timestamp: "completedAt",
        },
        undefined,
        { applicationCompletionEvidence: completionEvidence },
      );
    },
    closeCase: transition({
      action: "CLOSE",
      eventType: "CASE_CLOSED",
      status: "CLOSED",
      timestamp: "closedAt",
    }),
  };
};
