export type RequestCaseStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "CLOSED";

export type CaseAction =
  | "START_REVIEW"
  | "REQUEST_DOCUMENTS"
  | "REQUEST_PAYMENT"
  | "CANCEL_REQUIREMENT"
  | "APPROVE"
  | "REJECT"
  | "ATTACH_DELIVERABLE"
  | "COMPLETE"
  | "CLOSE"
  | "POST_MESSAGE";

export type AvailableCaseAction = CaseAction;

export interface CaseActor {
  id: string;
  role: "ADMIN" | "COADMIN" | "USER";
  ownsCase: boolean;
  mfaVerified: boolean;
}

export interface CaseSnapshot {
  status: RequestCaseStatus;
  openRequirements: number;
  hasCompletionRecord: boolean;
}

export class CaseDomainError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "CaseDomainError";
  }
}
