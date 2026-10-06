import { describe, expect, it } from "vitest";
import type {
  AppendCaseEventInput,
  CaseEventRecord,
  CaseRepository,
  CreateCaseRecordInput,
  RequestCaseRecord,
  UpdateCaseStatusInput,
} from "./repository";
import { createCaseService } from "./service";

class MemoryCaseRepository implements CaseRepository {
  cases: RequestCaseRecord[] = [];
  events: CaseEventRecord[] = [];
  notifications: any[] = [];

  async transaction<T>(operation: (repository: CaseRepository) => Promise<T>): Promise<T> {
    const casesBefore = structuredClone(this.cases);
    const eventsBefore = structuredClone(this.events);
    try {
      return await operation(this);
    } catch (error) {
      this.cases = casesBefore;
      this.events = eventsBefore;
      throw error;
    }
  }

  async loadCase(caseId: string): Promise<RequestCaseRecord | null> {
    return this.cases.find((requestCase) => requestCase.id === caseId) ?? null;
  }

  async createCase(input: CreateCaseRecordInput): Promise<RequestCaseRecord> {
    const requestCase: RequestCaseRecord = {
      ...input,
      status: "SUBMITTED",
      version: 0,
      openRequirements: 0,
      hasCompletionRecord: false,
    };
    this.cases.push(requestCase);
    return requestCase;
  }

  async updateStatus(input: UpdateCaseStatusInput): Promise<RequestCaseRecord | null> {
    const index = this.cases.findIndex(
      (requestCase) => requestCase.id === input.caseId && requestCase.version === input.expectedVersion,
    );
    if (index < 0) return null;
    this.cases[index] = { ...this.cases[index], ...input.changes, version: input.expectedVersion + 1 };
    return this.cases[index];
  }

  async appendEvent(input: AppendCaseEventInput): Promise<CaseEventRecord> {
    const event = { ...input };
    this.events.push(event);
    return event;
  }

  async findIdempotentEvent(caseId: string, idempotencyKey: string): Promise<CaseEventRecord | null> {
    return this.events.find((event) => event.caseId === caseId && event.idempotencyKey === idempotencyKey) ?? null;
  }

  async createCaseNotification(input: any): Promise<void> {
    this.notifications.push(input);
  }
}

const admin = { id: "admin", role: "ADMIN" as const, ownsCase: false, mfaVerified: true };

describe("case command service", () => {
  it("creates a case and CASE_SUBMITTED event atomically", async () => {
    const repository = new MemoryCaseRepository();
    const service = createCaseService(repository);

    const result = await service.createCase({
      type: "APPLICATION",
      ownerId: "user-1",
      applicationId: "application-1",
      idempotencyKey: "create-app-1",
    });

    expect(result.case.status).toBe("SUBMITTED");
    expect(repository.events).toMatchObject([{ type: "CASE_SUBMITTED", newStatus: "SUBMITTED" }]);
  });

  it("rolls back case creation when the event cannot be appended", async () => {
    const repository = new MemoryCaseRepository();
    repository.appendEvent = async () => {
      throw new Error("event write failed");
    };
    const service = createCaseService(repository);

    await expect(
      service.createCase({
        type: "CERTIFICATE",
        ownerId: "user-1",
        certificateRequestId: "certificate-1",
        idempotencyKey: "create-cert-1",
      }),
    ).rejects.toThrow("event write failed");
    expect(repository.cases).toHaveLength(0);
  });

  it("rejects a stale version without appending an event", async () => {
    const repository = new MemoryCaseRepository();
    const service = createCaseService(repository);
    const created = await service.createCase({
      type: "APPLICATION",
      ownerId: "user-1",
      applicationId: "application-1",
      idempotencyKey: "create-app-1",
    });
    repository.events = [];

    await expect(
      service.startReview({
        actor: admin,
        caseId: created.case.id,
        expectedVersion: 4,
        idempotencyKey: "review-1",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "CASE_VERSION_CONFLICT" });
    expect(repository.events).toHaveLength(0);
  });

  it("returns the first result for a repeated idempotency key", async () => {
    const repository = new MemoryCaseRepository();
    const service = createCaseService(repository);
    const created = await service.createCase({
      type: "APPLICATION",
      ownerId: "user-1",
      applicationId: "application-1",
      idempotencyKey: "create-app-1",
    });
    const messageCommand = {
      actor: { id: "user-1", role: "USER" as const, ownsCase: true, mfaVerified: false },
      caseId: created.case.id,
      expectedVersion: 0,
      idempotencyKey: "message-1",
      message: "Here is the requested clarification.",
    };

    const first = await service.postMessage(messageCommand);
    const second = await service.postMessage(messageCommand);

    expect(second.event.id).toBe(first.event.id);
    expect(repository.events.filter((event) => event.idempotencyKey === "message-1")).toHaveLength(1);
  });

  it("creates customer notification records with an administrator event", async () => {
    const repository = new MemoryCaseRepository();
    const service = createCaseService(repository);
    const created = await service.createCase({
      type: "APPLICATION",
      ownerId: "user-1",
      applicationId: "application-1",
      idempotencyKey: "create-app-1",
    });

    await service.startReview({
      actor: admin,
      caseId: created.case.id,
      expectedVersion: 0,
      idempotencyKey: "review-1",
    });

    expect(repository.notifications).toMatchObject([{
      recipientId: "user-1",
      eventId: expect.any(String),
      channels: ["IN_APP", "EMAIL"],
      templateKey: "case_review_started",
    }]);
  });
});
