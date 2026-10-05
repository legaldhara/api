import type { CaseSnapshot, RequestCaseStatus } from "./types";

export type RequestCaseType = "APPLICATION" | "CERTIFICATE";

export type CaseEventType =
  | "CASE_SUBMITTED"
  | "REVIEW_STARTED"
  | "USER_MESSAGE"
  | "ADMIN_MESSAGE"
  | "CASE_APPROVED"
  | "CASE_REJECTED"
  | "CASE_COMPLETED"
  | "CASE_CLOSED";

export interface RequestCaseRecord extends CaseSnapshot {
  id: string;
  type: RequestCaseType;
  ownerId: string;
  applicationId?: string;
  certificateRequestId?: string;
  version: number;
  approvedAt?: Date;
  rejectedAt?: Date;
  completedAt?: Date;
  closedAt?: Date;
}

export interface CreateCaseRecordInput {
  id: string;
  type: RequestCaseType;
  ownerId: string;
  applicationId?: string;
  certificateRequestId?: string;
}

export interface UpdateCaseStatusInput {
  caseId: string;
  expectedVersion: number;
  changes: Partial<Omit<RequestCaseRecord, "id" | "type" | "ownerId" | "version">>;
}

export interface CaseEventRecord {
  id: string;
  caseId: string;
  actorId?: string;
  actorRoleSnapshot?: "ADMIN" | "COADMIN" | "USER";
  type: CaseEventType;
  message?: string;
  previousStatus: RequestCaseStatus;
  newStatus: RequestCaseStatus;
  idempotencyKey: string;
  result: unknown;
}

export type AppendCaseEventInput = CaseEventRecord;

export interface CaseRepository {
  transaction<T>(operation: (repository: CaseRepository) => Promise<T>): Promise<T>;
  loadCase(caseId: string): Promise<RequestCaseRecord | null>;
  createCase(input: CreateCaseRecordInput): Promise<RequestCaseRecord>;
  updateStatus(input: UpdateCaseStatusInput): Promise<RequestCaseRecord | null>;
  appendEvent(input: AppendCaseEventInput): Promise<CaseEventRecord>;
  findIdempotentEvent(caseId: string, idempotencyKey: string): Promise<CaseEventRecord | null>;
}
