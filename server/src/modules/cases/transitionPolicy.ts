import {
  CaseDomainError,
  type AvailableCaseAction,
  type CaseAction,
  type CaseActor,
  type CaseSnapshot,
  type RequestCaseStatus,
} from "./types";

export const ADMIN_ACTIONS: Record<RequestCaseStatus, readonly CaseAction[]> = {
  SUBMITTED: ["START_REVIEW", "REJECT", "POST_MESSAGE"],
  UNDER_REVIEW: ["REQUEST_DOCUMENTS", "REQUEST_PAYMENT", "APPROVE", "REJECT", "POST_MESSAGE"],
  ACTION_REQUIRED: ["REQUEST_DOCUMENTS", "REQUEST_PAYMENT", "CANCEL_REQUIREMENT", "REJECT", "POST_MESSAGE"],
  APPROVED: ["ATTACH_DELIVERABLE", "COMPLETE", "POST_MESSAGE"],
  REJECTED: [],
  COMPLETED: ["CLOSE"],
  CLOSED: [],
};

const CUSTOMER_MESSAGE_STATUSES = new Set<RequestCaseStatus>([
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
  "APPROVED",
]);

const assertActorCanAct = (snapshot: CaseSnapshot, actor: CaseActor, action: CaseAction) => {
  if (snapshot.status === "REJECTED" || snapshot.status === "CLOSED") {
    throw new CaseDomainError("This case is closed to further changes", 409, "CASE_TERMINAL");
  }

  if (actor.role === "USER") {
    if (!actor.ownsCase) {
      throw new CaseDomainError("You do not own this case", 403, "CASE_FORBIDDEN");
    }
    if (action !== "POST_MESSAGE" || !CUSTOMER_MESSAGE_STATUSES.has(snapshot.status)) {
      throw new CaseDomainError("This action is not available", 409, "CASE_ACTION_NOT_AVAILABLE");
    }
    return;
  }

  if (!actor.mfaVerified) {
    throw new CaseDomainError("Current MFA verification is required", 403, "MFA_REQUIRED");
  }
  if (action === "CLOSE" && actor.role !== "ADMIN") {
    throw new CaseDomainError("Only an administrator can close a case", 403, "ADMIN_REQUIRED");
  }
  if (!ADMIN_ACTIONS[snapshot.status].includes(action)) {
    throw new CaseDomainError("This action is not available", 409, "CASE_ACTION_NOT_AVAILABLE");
  }
};

export const assertCaseAction = (snapshot: CaseSnapshot, actor: CaseActor, action: CaseAction): void => {
  assertActorCanAct(snapshot, actor, action);

  if ((action === "APPROVE" || action === "COMPLETE") && snapshot.openRequirements > 0) {
    throw new CaseDomainError("Resolve open requirements before continuing", 409, "OPEN_REQUIREMENTS");
  }
  if (action === "COMPLETE" && !snapshot.hasCompletionRecord) {
    throw new CaseDomainError("Completion evidence is required", 409, "COMPLETION_EVIDENCE_REQUIRED");
  }
};

export const availableCaseActions = (
  snapshot: CaseSnapshot,
  actor: CaseActor,
): AvailableCaseAction[] => {
  const candidates: readonly CaseAction[] =
    actor.role === "USER"
      ? CUSTOMER_MESSAGE_STATUSES.has(snapshot.status)
        ? ["POST_MESSAGE"]
        : []
      : ADMIN_ACTIONS[snapshot.status];

  return candidates.filter((action) => {
    try {
      assertCaseAction(snapshot, actor, action);
      return true;
    } catch {
      return false;
    }
  });
};
