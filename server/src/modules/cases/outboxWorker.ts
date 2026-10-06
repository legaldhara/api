import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db";
import { logger } from "../../utils/logger";
import { getCaseUpdateEmail } from "../../utils/email";
import { notificationForCaseEvent } from "./notificationPolicy";

export type OutboxDeliveryStatus = "PENDING" | "SENT" | "FAILED";

export interface CaseEmailOutboxJob {
  id: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  status: OutboxDeliveryStatus;
  attemptCount: number;
  availableAt: Date;
  leaseUntil?: Date;
  sentAt?: Date;
  failureReason?: string;
}

export interface CaseEmailOutboxRepository {
  leaseBatch(input: { limit: number; now: Date; leaseUntil: Date }): Promise<CaseEmailOutboxJob[]>;
  markSent(jobId: string, sentAt: Date): Promise<void>;
  markFailed(jobId: string, input: {
    attemptCount: number;
    availableAt: Date;
    failureReason: string;
  }): Promise<void>;
}

interface LeasedOutboxRow {
  id: string;
  status: OutboxDeliveryStatus;
  attemptCount: number;
  availableAt: Date;
  leaseUntil: Date | null;
  recipient: { id: string; email: string; fullName: string };
  event: { id: string; type: string };
  requestCase: {
    id: string;
    type: "APPLICATION" | "CERTIFICATE";
    ownerId: string;
    applicationId: string | null;
    certificateRequestId: string | null;
  };
}

const prismaOutboxRepository: CaseEmailOutboxRepository = {
  async leaseBatch(input) {
    const rows = await prisma.$transaction(async (transaction) => {
      const ids = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE "channel" = 'EMAIL'
          AND "status" IN ('PENDING', 'FAILED')
          AND "availableAt" <= ${input.now}
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${input.now})
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      `;
      if (ids.length === 0) return [];
      const jobIds = ids.map(({ id }) => id);
      await transaction.notificationOutbox.updateMany({
        where: { id: { in: jobIds } },
        data: { leaseUntil: input.leaseUntil },
      });
      return transaction.notificationOutbox.findMany({
        where: { id: { in: jobIds } },
        include: {
          recipient: { select: { id: true, email: true, fullName: true } },
          event: { select: { id: true, type: true } },
          requestCase: {
            select: {
              id: true,
              type: true,
              ownerId: true,
              applicationId: true,
              certificateRequestId: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    });

    return (rows as LeasedOutboxRow[]).flatMap((row) => {
      const notification = notificationForCaseEvent({
        id: row.event.id,
        type: row.event.type,
        caseId: row.requestCase.id,
        caseType: row.requestCase.type,
        targetId: row.requestCase.applicationId ?? row.requestCase.certificateRequestId ?? row.requestCase.id,
        ownerId: row.requestCase.ownerId,
      });
      if (!notification) return [];
      const email = getCaseUpdateEmail({
        fullName: row.recipient.fullName,
        title: notification.title,
        body: notification.body,
        clickAction: notification.clickAction,
      });
      return [{
        id: row.id,
        recipientEmail: row.recipient.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        status: row.status,
        attemptCount: row.attemptCount,
        availableAt: row.availableAt,
        leaseUntil: row.leaseUntil ?? undefined,
      }];
    });
  },
  async markSent(jobId, sentAt) {
    await prisma.notificationOutbox.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt, leaseUntil: null, failureReason: null },
    });
  },
  async markFailed(jobId, input) {
    await prisma.notificationOutbox.update({
      where: { id: jobId },
      data: { status: "FAILED", leaseUntil: null, ...input },
    });
  },
};

export interface CaseMailSender {
  send(to: string, subject: string, text: string, aliasFrom?: "info" | "support" | "contact", html?: string): Promise<void>;
}

export interface OutboxBatchResult {
  leased: number;
  sent: number;
  failed: number;
}

const safeFailureReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Email delivery failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
};

export const createCaseEmailOutboxWorker = (dependencies: {
  repository: CaseEmailOutboxRepository;
  mail: CaseMailSender;
}) => ({
  async process(input: { limit: number; now: Date }): Promise<OutboxBatchResult> {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
    const jobs = await dependencies.repository.leaseBatch({
      limit,
      now: input.now,
      leaseUntil: new Date(input.now.getTime() + 60_000),
    });
    const result: OutboxBatchResult = { leased: jobs.length, sent: 0, failed: 0 };

    for (const job of jobs) {
      try {
        await dependencies.mail.send(job.recipientEmail, job.subject, job.text, undefined, job.html);
        await dependencies.repository.markSent(job.id, input.now);
        result.sent += 1;
      } catch (error) {
        const attemptCount = job.attemptCount + 1;
        const delayMinutes = Math.min(60, 2 ** Math.min(attemptCount, 6));
        await dependencies.repository.markFailed(job.id, {
          attemptCount,
          availableAt: new Date(input.now.getTime() + delayMinutes * 60_000),
          failureReason: safeFailureReason(error),
        });
        result.failed += 1;
      }
    }
    return result;
  },
});

const holderId = `${process.pid}:${randomUUID()}`;

export const processCaseEmailOutbox = async (input: { limit: number; now: Date }): Promise<OutboxBatchResult> => {
  const rows = await prisma.$queryRaw<Array<{ holderId: string }>>`
    INSERT INTO "ScheduledJobLease" ("name", "holderId", "expiresAt", "updatedAt")
    VALUES ('case-email-outbox', ${holderId}, ${new Date(input.now.getTime() + 55_000)}, ${input.now})
    ON CONFLICT ("name") DO UPDATE
    SET "holderId" = EXCLUDED."holderId", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "ScheduledJobLease"."expiresAt" <= ${input.now}
       OR "ScheduledJobLease"."holderId" = ${holderId}
    RETURNING "holderId"
  `;
  if (rows[0]?.holderId !== holderId) return { leased: 0, sent: 0, failed: 0 };
  try {
    const { default: MailService } = await import("../../services/Mail");
    return await createCaseEmailOutboxWorker({ repository: prismaOutboxRepository, mail: MailService }).process(input);
  } finally {
    await prisma.scheduledJobLease.updateMany({
      where: { name: "case-email-outbox", holderId },
      data: { expiresAt: new Date() },
    });
  }
};

let outboxTimer: NodeJS.Timeout | undefined;
let outboxRunning = false;

export const startCaseEmailOutboxJob = () => {
  if (outboxTimer) return;
  outboxTimer = setInterval(() => {
    if (outboxRunning) return;
    outboxRunning = true;
    void processCaseEmailOutbox({ limit: 50, now: new Date() })
      .catch((error) => logger.error("[CaseOutbox] Processing failed", error))
      .finally(() => { outboxRunning = false; });
  }, 60_000);
  outboxTimer.unref();
};

export const stopCaseEmailOutboxJob = () => {
  if (outboxTimer) clearInterval(outboxTimer);
  outboxTimer = undefined;
  outboxRunning = false;
};
