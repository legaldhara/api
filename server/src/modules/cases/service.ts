import { randomUUID } from "node:crypto";
import type {
  CaseEventRecord,
  CaseEventType,
  CaseRepository,
  RequestCaseRecord,
  RequestCaseType,
} from "./repository";
import { assertCaseAction } from "./transitionPolicy";
import { CaseDomainError, type CaseAction, type CaseActor, type RequestCaseStatus } from "./types";

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

interface TransitionDefinition {
  action: CaseAction;
  eventType: CaseEventType;
  status?: RequestCaseStatus;
  timestamp?: "approvedAt" | "rejectedAt" | "completedAt" | "closedAt";
}

export const createCaseService = (repository: CaseRepository) => {
  const execute = async (
    input: CommandBase,
    definition: TransitionDefinition,
    message?: string,
  ): Promise<CaseCommandResult> =>
    repository.transaction(async (transaction) => {
      const duplicate = await transaction.findIdempotentEvent(input.caseId, input.idempotencyKey);
      if (duplicate) return duplicate.result as CaseCommandResult;

      const requestCase = await transaction.loadCase(input.caseId);
      if (!requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
      if (requestCase.version !== input.expectedVersion) {
        throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
      }

      assertCaseAction(requestCase, input.actor, definition.action);
      const changes: Parameters<CaseRepository["updateStatus"]>[0]["changes"] = {
        status: definition.status ?? requestCase.status,
      };
      if (definition.timestamp) changes[definition.timestamp] = new Date();

      const updatedCase = await transaction.updateStatus({
        caseId: input.caseId,
        expectedVersion: input.expectedVersion,
        changes,
      });
      if (!updatedCase) {
        throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
      }

      const event: EventView = {
        id: randomUUID(),
        caseId: input.caseId,
        actorId: input.actor.id,
        actorRoleSnapshot: input.actor.role,
        type: definition.eventType,
        message,
        previousStatus: requestCase.status,
        newStatus: updatedCase.status,
        idempotencyKey: input.idempotencyKey,
      };
      const result: CaseCommandResult = { case: updatedCase, event };
      await transaction.appendEvent({ ...event, result });
      return result;
    });

  const transition = (definition: TransitionDefinition) => (input: CommandBase) => execute(input, definition);

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
          id: randomUUID(),
          type: input.type,
          ownerId: input.ownerId,
          applicationId: input.applicationId,
          certificateRequestId: input.certificateRequestId,
        });
        const event: EventView = {
          id: randomUUID(),
          caseId: requestCase.id,
          type: "CASE_SUBMITTED",
          previousStatus: "SUBMITTED",
          newStatus: "SUBMITTED",
          idempotencyKey: input.idempotencyKey,
        };
        const result: CaseCommandResult = { case: requestCase, event };
        await transaction.appendEvent({ ...event, result });
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
    approveCase: transition({
      action: "APPROVE",
      eventType: "CASE_APPROVED",
      status: "APPROVED",
      timestamp: "approvedAt",
    }),
    rejectCase: transition({
      action: "REJECT",
      eventType: "CASE_REJECTED",
      status: "REJECTED",
      timestamp: "rejectedAt",
    }),
    completeCase: transition({
      action: "COMPLETE",
      eventType: "CASE_COMPLETED",
      status: "COMPLETED",
      timestamp: "completedAt",
    }),
    closeCase: transition({
      action: "CLOSE",
      eventType: "CASE_CLOSED",
      status: "CLOSED",
      timestamp: "closedAt",
    }),
  };
};
