import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createCaseEmailOutboxWorker, type CaseEmailOutboxJob } from "./outboxWorker";

const now = new Date("2026-10-06T10:00:00.000Z");

class MemoryOutboxRepository {
  jobs: CaseEmailOutboxJob[] = [{
    id: "job-1",
    recipientEmail: "customer@example.com",
    subject: "Case update",
    text: "Your case has been updated.",
    html: "<p>Your case has been updated.</p>",
    status: "PENDING",
    attemptCount: 0,
    availableAt: now,
  }];

  async leaseBatch(input: { limit: number; now: Date; leaseUntil: Date }) {
    return this.jobs
      .filter((job) => job.status !== "SENT" && job.availableAt <= input.now)
      .slice(0, input.limit)
      .map((job) => Object.assign(job, { leaseUntil: input.leaseUntil }));
  }

  async markSent(jobId: string, sentAt: Date) {
    Object.assign(this.jobs.find((job) => job.id === jobId), { status: "SENT", sentAt, leaseUntil: undefined });
  }

  async markFailed(jobId: string, input: { attemptCount: number; availableAt: Date; failureReason: string }) {
    Object.assign(this.jobs.find((job) => job.id === jobId), {
      status: "FAILED",
      ...input,
      leaseUntil: undefined,
    });
  }
}

describe("case email outbox worker", () => {
  it("loads through the ts-node CommonJS runtime", () => {
    expect(() => execFileSync(
      process.execPath,
      ["-r", "ts-node/register", "-e", "require('./src/modules/cases/outboxWorker')"],
      { cwd: process.cwd(), stdio: "pipe" },
    )).not.toThrow();
  }, 40_000);

  it("marks a delivered email SENT without duplicating it", async () => {
    const repository = new MemoryOutboxRepository();
    const mail = { send: vi.fn(async () => undefined) };
    const worker = createCaseEmailOutboxWorker({ repository, mail });

    const first = await worker.process({ limit: 10, now });
    const second = await worker.process({ limit: 10, now });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it("records a bounded failure and retries later", async () => {
    const repository = new MemoryOutboxRepository();
    const mail = { send: vi.fn().mockRejectedValueOnce(new Error(`smtp unavailable ${"x".repeat(1_000)}`)) };
    const worker = createCaseEmailOutboxWorker({ repository, mail });

    const result = await worker.process({ limit: 10, now });

    expect(result.failed).toBe(1);
    expect(repository.jobs[0]).toMatchObject({ status: "FAILED", attemptCount: 1 });
    expect(repository.jobs[0].failureReason?.length).toBeLessThanOrEqual(500);
    expect(repository.jobs[0].availableAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
