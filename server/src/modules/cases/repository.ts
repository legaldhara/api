import type { CaseSnapshot, RequestCaseStatus } from "./types";
import type { CreateChargeInput, PaymentChargeRecord } from "../payments/types";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { createCharge } from "../payments/chargeService";
import { createPaymentChargeRepository } from "../payments/repository";

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

type CasePrismaClient = Prisma.TransactionClient;

const toCaseRecord = (record: any): RequestCaseRecord => ({
  id: record.id,
  type: record.type,
  ownerId: record.ownerId,
  applicationId: record.applicationId ?? undefined,
  certificateRequestId: record.certificateRequestId ?? undefined,
  status: record.status,
  version: record.version,
  openRequirements: record._count?.requirements ?? 0,
  hasCompletionRecord: (record._count?.assets ?? 0) > 0 || Boolean(record.hasCompletionRecord),
  approvedAt: record.approvedAt ?? undefined,
  rejectedAt: record.rejectedAt ?? undefined,
  completedAt: record.completedAt ?? undefined,
  closedAt: record.closedAt ?? undefined,
});

const toRequirementRecord = (record: any): CaseRequirementRecord => ({
  id: record.id,
  caseId: record.caseId,
  type: record.type,
  status: record.status,
  createdBy: record.createdBy,
  title: record.title,
  instructions: record.instructions,
  documentLabels: record.documentLabels,
  fulfilledBy: record.fulfilledBy ?? undefined,
  fulfilledAt: record.fulfilledAt ?? undefined,
  cancelledBy: record.cancelledBy ?? undefined,
  cancelledAt: record.cancelledAt ?? undefined,
  cancellationReason: record.cancellationReason ?? undefined,
  paymentChargeId: record.paymentChargeId ?? undefined,
});

const jsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const buildPrismaCaseRepository = (
  client: CasePrismaClient,
  runTransaction: <T>(operation: (repository: CaseRepository) => Promise<T>) => Promise<T>,
): CaseRepository => {
  const repository: CaseRepository = {
    transaction: runTransaction,
    async loadCase(caseId) {
      const record = await client.requestCase.findUnique({
        where: { id: caseId },
        include: {
          _count: {
            select: {
              requirements: { where: { status: "OPEN" } },
              assets: { where: { purpose: "FINAL_DELIVERABLE" } },
            },
          },
        },
      });
      return record ? toCaseRecord(record) : null;
    },
    async createCase(input) {
      const record = await client.requestCase.create({ data: input });
      return toCaseRecord({ ...record, _count: { requirements: 0, assets: 0 } });
    },
    async updateStatus(input) {
      const data: Prisma.RequestCaseUpdateManyMutationInput = {};
      if (input.changes.status) data.status = input.changes.status;
      if (input.changes.approvedAt) data.approvedAt = input.changes.approvedAt;
      if (input.changes.rejectedAt) data.rejectedAt = input.changes.rejectedAt;
      if (input.changes.completedAt) data.completedAt = input.changes.completedAt;
      if (input.changes.closedAt) data.closedAt = input.changes.closedAt;
      data.version = { increment: 1 };
      const updated = await client.requestCase.updateMany({
        where: { id: input.caseId, version: input.expectedVersion },
        data,
      });
      return updated.count === 1 ? repository.loadCase(input.caseId) : null;
    },
    async appendEvent(input) {
      const event = await client.caseEvent.create({
        data: {
          id: input.id,
          caseId: input.caseId,
          actorId: input.actorId,
          actorRoleSnapshot: input.actorRoleSnapshot,
          type: input.type,
          message: input.message,
          previousStatus: input.previousStatus,
          newStatus: input.newStatus,
          idempotencyKey: input.idempotencyKey,
          requirementId: input.requirementId,
          paymentChargeId: input.paymentChargeId,
          metadata: input.metadata ? jsonValue(input.metadata) : undefined,
          result: jsonValue(input.result),
        },
      });
      return { ...input, id: event.id };
    },
    async findIdempotentEvent(caseId, idempotencyKey) {
      const event = await client.caseEvent.findUnique({
        where: { caseId_idempotencyKey: { caseId, idempotencyKey } },
      });
      return event ? {
        id: event.id,
        caseId: event.caseId,
        actorId: event.actorId ?? undefined,
        actorRoleSnapshot: event.actorRoleSnapshot ?? undefined,
        type: event.type,
        message: event.message ?? undefined,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        idempotencyKey: event.idempotencyKey,
        requirementId: event.requirementId ?? undefined,
        paymentChargeId: event.paymentChargeId ?? undefined,
        metadata: event.metadata as Record<string, unknown> | undefined,
        result: event.result,
      } : null;
    },
    async createRequirement(input) {
      return toRequirementRecord(await client.caseRequirement.create({ data: input }));
    },
    async loadRequirement(requirementId) {
      const record = await client.caseRequirement.findUnique({ where: { id: requirementId } });
      return record ? toRequirementRecord(record) : null;
    },
    async updateRequirement(input) {
      return toRequirementRecord(await client.caseRequirement.update({
        where: { id: input.requirementId },
        data: input.changes,
      }));
    },
    async listRequirementAssets(requirementId) {
      const records = await client.caseAsset.findMany({ where: { requirementId } });
      return records.map((record) => ({
        id: record.id,
        caseId: record.caseId,
        assetId: record.assetId,
        requirementId: record.requirementId ?? undefined,
        eventId: record.eventId ?? undefined,
        purpose: record.purpose,
        label: record.label ?? undefined,
      }));
    },
    async createCaseAssets(inputs) {
      await client.caseAsset.createMany({ data: inputs });
      return inputs;
    },
    async findOpenPaymentRequirement(caseId) {
      const record = await client.caseRequirement.findFirst({
        where: { caseId, type: "PAYMENT", status: "OPEN" },
      });
      return record ? toRequirementRecord(record) : null;
    },
    async findRequirementByPaymentCharge(chargeId) {
      const record = await client.caseRequirement.findUnique({ where: { paymentChargeId: chargeId } });
      return record ? toRequirementRecord(record) : null;
    },
    createPaymentCharge(input) {
      return createCharge(input, { repository: createPaymentChargeRepository(client) });
    },
    createCaseNotification(input) {
      return createPrismaCaseNotification(client, input);
    },
  };
  return repository;
};

export const createPrismaCaseRepository = (client: CasePrismaClient): CaseRepository => {
  let repository: CaseRepository;
  repository = buildPrismaCaseRepository(client, (operation) => operation(repository));
  return repository;
};

export const prismaCaseRepository: CaseRepository = buildPrismaCaseRepository(
  prisma as unknown as CasePrismaClient,
  (operation) => prisma.$transaction((transaction) => operation(createPrismaCaseRepository(transaction))),
);
