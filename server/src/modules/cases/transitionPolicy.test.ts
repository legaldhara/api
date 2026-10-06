import { describe, expect, it } from "vitest";
import { assertCaseAction, availableCaseActions } from "./transitionPolicy";

const admin = { id: "admin", role: "ADMIN" as const, ownsCase: false, mfaVerified: true };
const coadmin = { id: "coadmin", role: "COADMIN" as const, ownsCase: false, mfaVerified: true };
const user = { id: "user", role: "USER" as const, ownsCase: true, mfaVerified: false };

describe("case transition policy", () => {
  it.each([
    ["SUBMITTED", "START_REVIEW"],
    ["UNDER_REVIEW", "REQUEST_DOCUMENTS"],
    ["UNDER_REVIEW", "REQUEST_PAYMENT"],
    ["UNDER_REVIEW", "APPROVE"],
    ["ACTION_REQUIRED", "REJECT"],
    ["APPROVED", "ATTACH_DELIVERABLE"],
    ["APPROVED", "COMPLETE"],
    ["COMPLETED", "CLOSE"],
  ] as const)("allows admin %s -> %s", (status, action) => {
    expect(() =>
      assertCaseAction({ status, openRequirements: 0, hasCompletionRecord: true }, admin, action),
    ).not.toThrow();
  });

  it.each(["SUBMITTED", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED"] as const)(
    "allows an owner message while %s",
    (status) =>
      expect(() =>
        assertCaseAction({ status, openRequirements: 0, hasCompletionRecord: false }, user, "POST_MESSAGE"),
      ).not.toThrow(),
  );

  it.each(["REJECTED", "CLOSED"] as const)("blocks every mutation in terminal state %s", (status) => {
    expect(availableCaseActions({ status, openRequirements: 0, hasCompletionRecord: true }, admin)).toEqual([]);
  });

  it("blocks approval with open requirements", () => {
    expect(() =>
      assertCaseAction(
        { status: "UNDER_REVIEW", openRequirements: 1, hasCompletionRecord: false },
        admin,
        "APPROVE",
      ),
    ).toThrowError(expect.objectContaining({ code: "OPEN_REQUIREMENTS" }));
  });

  it("requires completion evidence and no open requirements", () => {
    expect(() =>
      assertCaseAction({ status: "APPROVED", openRequirements: 0, hasCompletionRecord: false }, admin, "COMPLETE"),
    ).toThrowError(expect.objectContaining({ code: "COMPLETION_EVIDENCE_REQUIRED" }));

    expect(() =>
      assertCaseAction({ status: "APPROVED", openRequirements: 1, hasCompletionRecord: true }, admin, "COMPLETE"),
    ).toThrowError(expect.objectContaining({ code: "OPEN_REQUIREMENTS" }));
  });

  it("requires MFA for administrators", () => {
    expect(() =>
      assertCaseAction(
        { status: "SUBMITTED", openRequirements: 0, hasCompletionRecord: false },
        { ...admin, mfaVerified: false },
        "START_REVIEW",
      ),
    ).toThrowError(expect.objectContaining({ code: "MFA_REQUIRED" }));
  });

  it("requires customer ownership", () => {
    expect(() =>
      assertCaseAction(
        { status: "SUBMITTED", openRequirements: 0, hasCompletionRecord: false },
        { ...user, ownsCase: false },
        "POST_MESSAGE",
      ),
    ).toThrowError(expect.objectContaining({ code: "CASE_FORBIDDEN" }));
  });

  it("reserves closing for administrators", () => {
    expect(() =>
      assertCaseAction({ status: "COMPLETED", openRequirements: 0, hasCompletionRecord: true }, coadmin, "CLOSE"),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_REQUIRED" }));
  });
});
