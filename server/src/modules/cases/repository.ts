import type { CaseSnapshot, RequestCaseStatus } from "./types";
import type { CreateChargeInput, PaymentChargeRecord } from "../payments/types";
import type { Prisma } from "@prisma/client";

export type RequestCaseType = "APPLICATION" | "CERTIFICATE";

export type CaseEventType =
  | "CASE_SUBMITTED"
  | "REVIEW_STARTED"
  | "DOCUMENTS_REQUESTED"
  | "DOCUMENTS_SUBMITTED"
  | "PAYMENT_REQUESTED"
  | "PAYMENT_CONFIRMED"
  | "REQUIREMENT_CANCELLED"
  | "USER_MESSAGE"
  | "ADMIN_MESSAGE"
  | "CASE_APPROVED"
  | "CASE_REJECTED"
  | "DELIVERABLE_ATTACHED"
  | "CASE_COMPLETED"
  | "CASE_CLOSED";

export interface CaseRequirementRecord {
  id: string;
  caseId: string;
  type: "DOCUMENT" | "PAYMENT";
  status: "OPEN" | "FULFILLED" | "CANCELLED";
  createdBy: string;
  title: string;
  instructions: string;
  documentLabels: string[];
  fulfilledBy?: string;
  fulfilledAt?: Date;
  cancelledBy?: string;
  cancelledAt?: Date;
  cancellationReason?: string;
  paymentChargeId?: string;
}

export interface CaseAssetRecord {
  id: string;
  caseId: string;
  assetId: string;
  requirementId?: string;
  eventId?: string;
  purpose: "REQUIREMENT_DOCUMENT" | "FINAL_DELIVERABLE";
  label?: string;
}

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
  requirementId?: string;
  paymentChargeId?: string;
  metadata?: Record<string, unknown>;
  result: unknown;
}

export type AppendCaseEventInput = CaseEventRecord;

export interface CreateCaseNotificationInput {
  caseId: string;
  eventId: string;
  recipientId: string;
  channels: ["IN_APP", "EMAIL"];
  title: string;
  body: string;
  templateKey: string;
  clickAction: string;
}

export interface CaseRepository {
  transaction<T>(operation: (repository: CaseRepository) => Promise<T>): Promise<T>;
  loadCase(caseId: string): Promise<RequestCaseRecord | null>;
  createCase(input: CreateCaseRecordInput): Promise<RequestCaseRecord>;
  updateStatus(input: UpdateCaseStatusInput): Promise<RequestCaseRecord | null>;
  appendEvent(input: AppendCaseEventInput): Promise<CaseEventRecord>;
  findIdempotentEvent(caseId: string, idempotencyKey: string): Promise<CaseEventRecord | null>;
  createRequirement(input: Omit<CaseRequirementRecord, "status">): Promise<CaseRequirementRecord>;
  loadRequirement(requirementId: string): Promise<CaseRequirementRecord | null>;
  updateRequirement(input: {
    requirementId: string;
    changes: Partial<Omit<CaseRequirementRecord, "id" | "caseId" | "type" | "createdBy">>;
  }): Promise<CaseRequirementRecord>;
  listRequirementAssets(requirementId: string): Promise<CaseAssetRecord[]>;
  createCaseAssets(inputs: CaseAssetRecord[]): Promise<CaseAssetRecord[]>;
  findOpenPaymentRequirement(caseId: string): Promise<CaseRequirementRecord | null>;
  findRequirementByPaymentCharge(chargeId: string): Promise<CaseRequirementRecord | null>;
  createPaymentCharge(input: CreateChargeInput): Promise<PaymentChargeRecord>;
  createCaseNotification?(input: CreateCaseNotificationInput): Promise<void>;
}

export const createPrismaCaseNotification = async (
  client: Pick<Prisma.TransactionClient, "notification" | "notificationRead" | "notificationOutbox">,
  input: CreateCaseNotificationInput,
): Promise<void> => {
  const notification = await client.notification.create({
    data: {
      title: input.title,
      body: input.body,
      role: "USER",
      audienceType: "SPECIFIC",
      notificationType: input.templateKey,
      clickAction: input.clickAction,
      caseEventId: input.eventId,
    },
  });
  await client.notificationRead.create({
    data: { notificationId: notification.id, userId: input.recipientId, isRead: false },
  });
  await client.notificationOutbox.create({
    data: {
      caseId: input.caseId,
      eventId: input.eventId,
      recipientId: input.recipientId,
      channel: "EMAIL",
      templateKey: input.templateKey,
    },
  });
};
