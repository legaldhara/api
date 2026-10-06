import { describe, expect, it } from "vitest";
import { notificationForCaseEvent } from "./notificationPolicy";

const ownerId = "user-1";
const event = (type: string) => ({
  id: "event-1",
  type,
  caseId: "case-1",
  caseType: "APPLICATION" as const,
  targetId: "application-1",
  ownerId,
});

describe("case notification policy", () => {
  it.each([
    "REVIEW_STARTED",
    "ADMIN_MESSAGE",
    "DOCUMENTS_REQUESTED",
    "PAYMENT_REQUESTED",
    "CASE_APPROVED",
    "CASE_REJECTED",
    "DELIVERABLE_ATTACHED",
    "CASE_COMPLETED",
    "CASE_CLOSED",
  ] as const)("creates customer notification for %s", (type) => {
    expect(notificationForCaseEvent(event(type))).toMatchObject({
      recipientId: ownerId,
      channels: ["IN_APP", "EMAIL"],
    });
  });

  it("does not email the customer for their own message", () => {
    expect(notificationForCaseEvent(event("USER_MESSAGE"))).toBeNull();
  });
});
