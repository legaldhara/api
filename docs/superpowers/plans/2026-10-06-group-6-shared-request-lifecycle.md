# Group 6 Shared Request Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate application and certificate workflows with one server-enforced lifecycle, independent requirements, immutable events, and reliable customer notifications.

**Architecture:** Add `RequestCase` as the lifecycle authority while retaining `Application` and `CertificateRequest` for request-specific data. A command-oriented lifecycle service owns transitions, requirements, events, asset links, notification records, and email outbox jobs. Existing detail routes expose a shared lifecycle response while new case command routes replace unrestricted update payloads.

**Tech Stack:** Node.js 22, TypeScript 5.8, Express 5, Prisma 6, PostgreSQL 16, Zod 4, Vitest 5, React 18/19, Next.js 16, Vite 6, Redux Toolkit, Axios, Nodemailer

**Spec:** `docs/superpowers/specs/2026-10-06-group-6-shared-request-lifecycle-design.md`

## Global Constraints

- Use `SUBMITTED`, `UNDER_REVIEW`, `ACTION_REQUIRED`, `APPROVED`, `REJECTED`, `COMPLETED`, and `CLOSED` as the only shared lifecycle statuses.
- Treat `REJECTED` and `CLOSED` as terminal. Permit only `COMPLETED -> CLOSED` from `COMPLETED`.
- Store document and payment work as independent requirements. Do not encode pending work in timeline flags.
- Let customers post text messages in `SUBMITTED`, `UNDER_REVIEW`, `ACTION_REQUIRED`, and `APPROVED`.
- Accept payment fulfilment only from the Group 4 settlement service.
- Keep events append-only. Add no event update or delete operation.
- Require strict Zod schemas for every command. Clients cannot choose event types, actor identity, payment result, or timeline metadata.
- Require authenticated ownership for customer commands and `ADMIN` or `COADMIN` plus current MFA for administrator commands. Closing requires `ADMIN`.
- Create in-app notifications and email outbox rows in the lifecycle transaction. Send email only after commit.
- Preserve the current website and admin visual layouts.
- Add a failing regression test before each behavior change.
- Ask the user to start Docker before database integration tests. Do not start Docker without approval.
- Ask the user to run full test, lint, type-check, and build commands at each repository checkpoint.

---

### Task 1: Add the Shared Lifecycle Schema

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_shared_request_lifecycle/migration.sql`
- Create: `server/src/modules/cases/caseModel.test.ts`

**Interfaces:**
- Produces Prisma types: `RequestCase`, `CaseEvent`, `CaseRequirement`, `CaseAsset`, `NotificationOutbox`
- Produces enums: `RequestCaseType`, `RequestCaseStatus`, `CaseEventType`, `CaseRequirementType`, `CaseRequirementStatus`, `CaseAssetPurpose`, `OutboxDeliveryStatus`
- Keeps current application/certificate lifecycle fields temporarily so existing controllers compile until Task 11
- Adds `CASE` to `AssetContext` for assets attached through the shared lifecycle

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("shared request lifecycle schema", () => {
  it("defines one lifecycle authority for applications and certificates", () => {
    expect(schema).toContain("model RequestCase {");
    expect(schema).toContain("applicationId          String?              @unique @db.Uuid");
    expect(schema).toContain("certificateRequestId   String?              @unique @db.Uuid");
    expect(schema).toContain("version                Int                  @default(0)");
    expect(schema).toContain("enum RequestCaseStatus {");
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED", "REJECTED", "COMPLETED", "CLOSED"]) {
      expect(schema).toContain(status);
    }
  });

  it("stores immutable events, requirements, assets, and email jobs", () => {
    for (const model of ["CaseEvent", "CaseRequirement", "CaseAsset", "NotificationOutbox"]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).toContain("@@unique([caseId, idempotencyKey])");
    expect(schema).toContain("@@unique([eventId, recipientId, channel, templateKey])");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-model failure**

Run:

```powershell
cd D:\LegalDhara\repos\api\server
npm test -- src/modules/cases/caseModel.test.ts
```

Expected: FAIL because `RequestCase` and the related models do not exist.

- [ ] **Step 3: Add enums and models to the Prisma schema**

Add the exact enum values from the test and these model relationships:

```prisma
model RequestCase {
  id                   String            @id @default(uuid()) @db.Uuid
  type                 RequestCaseType
  ownerId              String            @db.Uuid
  applicationId        String?           @unique @db.Uuid
  certificateRequestId String?           @unique @db.Uuid
  status               RequestCaseStatus @default(SUBMITTED)
  version              Int               @default(0)
  submittedAt          DateTime          @default(now())
  approvedAt           DateTime?
  rejectedAt           DateTime?
  completedAt          DateTime?
  closedAt             DateTime?
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt
  owner                User              @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  application          Application?      @relation(fields: [applicationId], references: [id], onDelete: Restrict)
  certificateRequest   CertificateRequest? @relation(fields: [certificateRequestId], references: [id], onDelete: Restrict)
  events               CaseEvent[]
  requirements         CaseRequirement[]
  assets               CaseAsset[]
  outbox                NotificationOutbox[]

  @@index([ownerId, createdAt])
  @@index([status, updatedAt])
}
```

Add reverse relations to `User`, `Application`, `CertificateRequest`, `UploadedAsset`, `PaymentCharge`, and `Notification`. Define `CaseEvent`, `CaseRequirement`, `CaseAsset`, and `NotificationOutbox` using the fields and uniqueness rules in the spec. Store payment amounts only in `PaymentCharge`; `CaseRequirement` contains `paymentChargeId String? @unique`.

- [ ] **Step 4: Generate the migration SQL**

After the user starts Docker, run:

```powershell
cd D:\LegalDhara\repos\api\server
npx prisma migrate dev --name shared_request_lifecycle --create-only
```

Add database checks to the generated SQL:

```sql
ALTER TABLE "RequestCase" ADD CONSTRAINT "RequestCase_exactly_one_target_check"
CHECK (
  ("type" = 'APPLICATION' AND "applicationId" IS NOT NULL AND "certificateRequestId" IS NULL)
  OR
  ("type" = 'CERTIFICATE' AND "certificateRequestId" IS NOT NULL AND "applicationId" IS NULL)
);

ALTER TABLE "CaseRequirement" ADD CONSTRAINT "CaseRequirement_payment_link_check"
CHECK (
  ("type" = 'PAYMENT' AND "paymentChargeId" IS NOT NULL)
  OR
  ("type" = 'DOCUMENT' AND "paymentChargeId" IS NULL)
);
```

- [ ] **Step 5: Generate Prisma and verify the contract**

Run:

```powershell
npx prisma generate
npm test -- src/modules/cases/caseModel.test.ts
npm run typecheck
```

Expected: model test PASS and type-check PASS.

- [ ] **Step 6: Commit the schema checkpoint**

```powershell
git add server/prisma server/src/modules/cases/caseModel.test.ts
git commit -m "Add shared request lifecycle schema"
```

---

### Task 2: Implement the Pure Transition Policy

**Files:**
- Create: `server/src/modules/cases/types.ts`
- Create: `server/src/modules/cases/transitionPolicy.ts`
- Create: `server/src/modules/cases/transitionPolicy.test.ts`

**Interfaces:**
- Produces `CaseActor`, `CaseAction`, `CaseSnapshot`, `AvailableCaseAction`
- Produces `assertCaseAction(snapshot, actor, action): void`
- Produces `availableCaseActions(snapshot, actor): AvailableCaseAction[]`
- Throws `CaseDomainError(message, statusCode, code)`

- [ ] **Step 1: Write failing table-driven transition tests**

```ts
import { describe, expect, it } from "vitest";
import { assertCaseAction, availableCaseActions } from "./transitionPolicy";

const admin = { id: "admin", role: "ADMIN" as const, ownsCase: false, mfaVerified: true };
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
    expect(() => assertCaseAction({ status, openRequirements: 0, hasCompletionRecord: true }, admin, action)).not.toThrow();
  });

  it.each(["SUBMITTED", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED"] as const)(
    "allows an owner message while %s",
    (status) => expect(() => assertCaseAction({ status, openRequirements: 0, hasCompletionRecord: false }, user, "POST_MESSAGE")).not.toThrow(),
  );

  it.each(["REJECTED", "CLOSED"] as const)("blocks every mutation in terminal state %s", (status) => {
    expect(availableCaseActions({ status, openRequirements: 0, hasCompletionRecord: true }, admin)).toEqual([]);
  });

  it("blocks approval with open requirements", () => {
    expect(() => assertCaseAction({ status: "UNDER_REVIEW", openRequirements: 1, hasCompletionRecord: false }, admin, "APPROVE"))
      .toThrowErrorMatchingObject({ code: "OPEN_REQUIREMENTS" });
  });
});
```

- [ ] **Step 2: Run the policy test and confirm missing-module failure**

Run: `npm test -- src/modules/cases/transitionPolicy.test.ts`

Expected: FAIL because `transitionPolicy.ts` does not exist.

- [ ] **Step 3: Implement explicit transition maps and guards**

```ts
export const ADMIN_ACTIONS = {
  SUBMITTED: ["START_REVIEW", "REJECT", "POST_MESSAGE"],
  UNDER_REVIEW: ["REQUEST_DOCUMENTS", "REQUEST_PAYMENT", "APPROVE", "REJECT", "POST_MESSAGE"],
  ACTION_REQUIRED: ["REQUEST_DOCUMENTS", "REQUEST_PAYMENT", "CANCEL_REQUIREMENT", "REJECT", "POST_MESSAGE"],
  APPROVED: ["ATTACH_DELIVERABLE", "COMPLETE", "POST_MESSAGE"],
  REJECTED: [],
  COMPLETED: ["CLOSE"],
  CLOSED: [],
} as const;
```

Enforce MFA for admin actions, ownership for user actions, no open requirements for approval/completion, completion evidence for completion, and `ADMIN` rather than `COADMIN` for close.

- [ ] **Step 4: Run policy tests and type-check**

Run:

```powershell
npm test -- src/modules/cases/transitionPolicy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the policy checkpoint**

```powershell
git add server/src/modules/cases
git commit -m "Enforce shared lifecycle transitions"
```

---

### Task 3: Build the Lifecycle Repository and Core Commands

**Files:**
- Create: `server/src/modules/cases/repository.ts`
- Create: `server/src/modules/cases/service.ts`
- Create: `server/src/modules/cases/service.test.ts`

**Interfaces:**
- Consumes `assertCaseAction` from Task 2
- Produces `CaseRepository` with `transaction`, `loadCase`, `createCase`, `updateStatus`, `appendEvent`, and `findIdempotentEvent`
- Produces commands `createCase`, `startReview`, `postMessage`, `approveCase`, `rejectCase`, `completeCase`, and `closeCase`
- Every command receives `{ actor, caseId, expectedVersion, idempotencyKey, ...input }`

- [ ] **Step 1: Write failing service tests with a memory repository**

```ts
it("creates a case and CASE_SUBMITTED event atomically", async () => {
  const result = await service.createCase({
    type: "APPLICATION",
    ownerId: userId,
    applicationId,
    idempotencyKey: "create-app-1",
  });
  expect(result.case.status).toBe("SUBMITTED");
  expect(repository.events).toMatchObject([{ type: "CASE_SUBMITTED", newStatus: "SUBMITTED" }]);
});

it("rejects a stale version without appending an event", async () => {
  await expect(service.startReview({
    actor: admin,
    caseId,
    expectedVersion: 4,
    idempotencyKey: "review-1",
  })).rejects.toMatchObject({ statusCode: 409, code: "CASE_VERSION_CONFLICT" });
  expect(repository.events).toHaveLength(0);
});

it("returns the first result for a repeated idempotency key", async () => {
  const first = await service.postMessage(messageCommand);
  const second = await service.postMessage(messageCommand);
  expect(second.event.id).toBe(first.event.id);
  expect(repository.events).toHaveLength(1);
});
```

- [ ] **Step 2: Run the service test and confirm missing-service failure**

Run: `npm test -- src/modules/cases/service.test.ts`

Expected: FAIL because the repository and service do not exist.

- [ ] **Step 3: Implement transactional command execution**

Use one internal executor:

```ts
const execute = async <T>(input: CommandBase, operation: (context: CommandContext) => Promise<T>) =>
  repository.transaction(async (transaction) => {
    const duplicate = await repository.findIdempotentEvent(input.caseId, input.idempotencyKey, transaction);
    if (duplicate) return duplicate.result as T;
    const requestCase = await repository.loadCase(input.caseId, transaction);
    if (!requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
    if (requestCase.version !== input.expectedVersion) {
      throw new CaseDomainError("Case changed; refresh and retry", 409, "CASE_VERSION_CONFLICT");
    }
    return operation({ transaction, requestCase });
  });
```

Each command, including `postMessage`, conditionally increments `version` and appends one event with server-generated type, actor snapshot, previous status, new status, and safe metadata. `postMessage` keeps the same status while still advancing the version so concurrent replies and administrator actions receive deterministic ordering.

- [ ] **Step 4: Run core service tests**

Run:

```powershell
npm test -- src/modules/cases/service.test.ts src/modules/cases/transitionPolicy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit core commands**

```powershell
git add server/src/modules/cases
git commit -m "Add shared lifecycle command service"
```

---

### Task 4: Add Document Requirements and Case Assets

**Files:**
- Modify: `server/src/modules/cases/repository.ts`
- Modify: `server/src/modules/cases/service.ts`
- Create: `server/src/modules/cases/requirements.test.ts`
- Modify: `server/src/services/uploadedAsset.ts`

**Interfaces:**
- Produces `requestDocuments`, `submitDocuments`, `cancelRequirement`, and `attachDeliverable`
- Consumes `claimAssetReferences` from `server/src/services/uploadedAsset.ts`
- Produces `RequirementResult` containing updated case, requirement, event, and `availableActions`

- [ ] **Step 1: Write failing requirement tests**

```ts
it("keeps the case actionable until every requested document label has an owned asset", async () => {
  const requested = await service.requestDocuments({
    actor: admin,
    caseId,
    expectedVersion: 1,
    idempotencyKey: "docs-1",
    title: "Identity documents",
    instructions: "Upload readable copies",
    documentLabels: ["PAN", "AADHAAR"],
  });
  expect(requested.case.status).toBe("ACTION_REQUIRED");

  const partial = await service.submitDocuments({
    actor: owner,
    caseId,
    requirementId: requested.requirement.id,
    expectedVersion: 2,
    idempotencyKey: "docs-submit-1",
    assets: [{ label: "PAN", assetId: panAssetId }],
  });
  expect(partial.requirement.status).toBe("OPEN");
  expect(partial.case.status).toBe("ACTION_REQUIRED");
});

it("returns to review after the final open requirement is fulfilled", async () => {
  const result = await service.submitDocuments(finalDocumentCommand);
  expect(result.requirement.status).toBe("FULFILLED");
  expect(result.case.status).toBe("UNDER_REVIEW");
  expect(result.events.map((event) => event.type)).toEqual(["DOCUMENTS_SUBMITTED", "REVIEW_STARTED"]);
});

it("rejects an asset owned by another user", async () => {
  await expect(service.submitDocuments(foreignAssetCommand)).rejects.toMatchObject({
    statusCode: 403,
    code: "ASSET_NOT_OWNED",
  });
});
```

- [ ] **Step 2: Run the requirement test and confirm missing-command failure**

Run: `npm test -- src/modules/cases/requirements.test.ts`

Expected: FAIL because requirement commands do not exist.

- [ ] **Step 3: Implement document requirement commands**

Validate document labels as unique trimmed strings, one to twenty labels, each no more than 80 characters. Validate title and instructions with the limits used by the command schemas in Task 7. Claim each temporary asset with `AssetContext.APPLICATION_UPDATE` or add `AssetContext.CASE` if Prisma supports the enum migration cleanly. Create `CaseAsset` rows rather than placing asset URLs in JSON.

When the final open requirement becomes fulfilled or cancelled, update `ACTION_REQUIRED -> UNDER_REVIEW` and append the system review event in the same transaction.

- [ ] **Step 4: Implement completion asset rules**

`attachDeliverable` claims an owned asset as `FINAL_DELIVERABLE`. Require at least one final asset for certificate completion. For applications, permit either a final asset or a bounded completion summary and reference.

- [ ] **Step 5: Run requirement and asset tests**

Run:

```powershell
npm test -- src/modules/cases/requirements.test.ts src/services/uploadedAsset.test.ts src/services/assetReferences.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit requirement support**

```powershell
git add server/src/modules/cases server/src/services/uploadedAsset.ts
git commit -m "Track case document requirements"
```

---

### Task 5: Integrate Payment Requirements with Group 4

**Files:**
- Modify: `server/src/modules/cases/repository.ts`
- Modify: `server/src/modules/cases/service.ts`
- Create: `server/src/modules/cases/paymentRequirements.test.ts`
- Modify: `server/src/modules/payments/targetAdapters.ts`
- Modify: `server/src/modules/payments/targetAdapters.test.ts`
- Modify: `server/src/modules/payments/domainChargeCreation.ts`
- Modify: `server/src/modules/payments/types.ts`

**Interfaces:**
- Produces `requestPayment`
- Produces `recordPaymentSettlement({ caseId, requirementId, chargeId, attemptId }, transaction)`
- Changes `PaymentTargetAdapter.applyPaidCharge` to fulfil the linked case requirement rather than writing old status fields

- [ ] **Step 1: Write failing payment requirement tests**

```ts
it("creates one open requirement linked to a server-derived charge", async () => {
  const result = await service.requestPayment({
    actor: admin,
    caseId,
    expectedVersion: 1,
    idempotencyKey: "payment-request-1",
    category: "ADDITIONAL",
    amountMinor: 125000,
    purpose: "Government filing fee",
  });
  expect(result.requirement).toMatchObject({ type: "PAYMENT", status: "OPEN" });
  expect(result.charge).toMatchObject({ amountMinor: 125000, status: "OPEN" });
  expect(result.case.status).toBe("ACTION_REQUIRED");
});

it("rejects a second open payment requirement", async () => {
  await expect(service.requestPayment(secondPaymentCommand)).rejects.toMatchObject({
    statusCode: 409,
    code: "OPEN_PAYMENT_REQUIREMENT_EXISTS",
  });
});

it("fulfils payment only through settlement and returns to review", async () => {
  const result = await service.recordPaymentSettlement(settlementInput, transaction);
  expect(result.requirement.status).toBe("FULFILLED");
  expect(result.case.status).toBe("UNDER_REVIEW");
  expect(result.event.type).toBe("PAYMENT_CONFIRMED");
});
```

- [ ] **Step 2: Run payment requirement tests and confirm failure**

Run: `npm test -- src/modules/cases/paymentRequirements.test.ts src/modules/payments/targetAdapters.test.ts`

Expected: FAIL because settlement still writes legacy application/certificate statuses.

- [ ] **Step 3: Create payment requirements in the lifecycle transaction**

Validate `amountMinor` as a positive safe integer with a configured maximum. Call the existing charge repository in the same Prisma transaction. Link `CaseRequirement.paymentChargeId` to the resulting charge and append `PAYMENT_REQUESTED`.

- [ ] **Step 4: Replace application/certificate target advancement**

Change the payment adapter interface to:

```ts
export interface PaymentTargetRepository {
  fulfilCasePayment(input: {
    chargeId: string;
    attemptId: string;
  }, transaction: unknown): Promise<void>;
  activatePlan(input: PlanActivationInput, transaction: unknown): Promise<void>;
}
```

Resolve the case requirement by `paymentChargeId`. Call `recordPaymentSettlement` inside the existing settlement transaction. Keep plan activation unchanged.

- [ ] **Step 5: Run payment and settlement tests**

Run:

```powershell
npm test -- src/modules/cases/paymentRequirements.test.ts src/modules/payments/targetAdapters.test.ts src/modules/payments/settlementService.test.ts src/modules/payments/domainChargeCreation.test.ts
npm run typecheck
```

Expected: PASS, including duplicate settlement idempotency.

- [ ] **Step 6: Commit payment integration**

```powershell
git add server/src/modules/cases server/src/modules/payments
git commit -m "Link payments to case requirements"
```

---

### Task 6: Add In-App Notifications and Email Outbox Delivery

**Files:**
- Create: `server/src/modules/cases/notificationPolicy.ts`
- Create: `server/src/modules/cases/notificationPolicy.test.ts`
- Create: `server/src/modules/cases/outboxWorker.ts`
- Create: `server/src/modules/cases/outboxWorker.test.ts`
- Modify: `server/src/modules/cases/service.ts`
- Modify: `server/src/utils/email.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces `notificationForCaseEvent(event): CaseNotification | null`
- Produces `processCaseEmailOutbox({ limit, now }): Promise<OutboxBatchResult>`
- Reuses `MailService` for delivery

- [ ] **Step 1: Write failing notification policy tests**

```ts
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
```

- [ ] **Step 2: Write failing outbox retry tests**

```ts
it("marks a delivered email SENT without duplicating it", async () => {
  const first = await worker.process({ limit: 10, now });
  const second = await worker.process({ limit: 10, now });
  expect(first.sent).toBe(1);
  expect(second.sent).toBe(0);
  expect(mail.send).toHaveBeenCalledTimes(1);
});

it("records a bounded failure and retries later", async () => {
  mail.send.mockRejectedValueOnce(new Error("smtp unavailable"));
  const result = await worker.process({ limit: 10, now });
  expect(result.failed).toBe(1);
  expect(repository.jobs[0]).toMatchObject({ status: "FAILED", attemptCount: 1 });
});
```

- [ ] **Step 3: Run notification tests and confirm missing-module failure**

Run: `npm test -- src/modules/cases/notificationPolicy.test.ts src/modules/cases/outboxWorker.test.ts`

Expected: FAIL.

- [ ] **Step 4: Create notification records inside lifecycle transactions**

Map each administrator event to a safe title, message, template key, and application/certificate detail URL. Insert the in-app notification and email outbox row with the event. Rely on the database unique key for retry deduplication.

- [ ] **Step 5: Implement bounded outbox processing**

Process at most 50 `PENDING` or retryable `FAILED` jobs ordered by creation time. Claim jobs with a lease timestamp, send through `MailService`, and update `SENT` or `FAILED`. Store a bounded safe failure reason, never SMTP credentials or message content.

Register a one-minute worker interval in `server/src/index.ts`, clear it during shutdown, and skip overlapping runs with a database lease.

- [ ] **Step 6: Run notification tests and type-check**

Run:

```powershell
npm test -- src/modules/cases/notificationPolicy.test.ts src/modules/cases/outboxWorker.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit notification delivery**

```powershell
git add server/src/modules/cases server/src/utils/email.ts server/src/index.ts
git commit -m "Notify customers of case actions"
```

---

### Task 7: Add Strict Case Command Routes and Shared Read Contract

**Files:**
- Create: `server/src/modules/cases/schemas.ts`
- Create: `server/src/modules/cases/case.controller.ts`
- Create: `server/src/modules/cases/case.route.ts`
- Create: `server/src/modules/cases/case.route.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/controller/application.controller.ts`
- Modify: `server/src/controller/certificate.controller.ts`
- Modify: `server/src/routes/application.route.ts`
- Modify: `server/src/routes/certificate.routes.ts`

**Interfaces:**
- Consumes lifecycle commands from Tasks 3 through 6
- Produces `/api/v1/cases/:caseId/*` command routes from the spec
- Produces `serializeLifecycle(caseId, actor): LifecycleResponse`
- Existing application/certificate detail responses gain `lifecycle`

- [ ] **Step 1: Write failing route authorization and schema tests**

```ts
it("rejects a client-supplied event type and status", async () => {
  const response = await request(app)
    .post(`/api/v1/cases/${caseId}/messages`)
    .set(customerHeaders)
    .send({ message: "Question", type: "PAYMENT_CONFIRMED", status: "COMPLETED", expectedVersion: 2, idempotencyKey: "msg-1" });
  expect(response.status).toBe(400);
});

it("requires admin MFA for document requests", async () => {
  const response = await request(app)
    .post(`/api/v1/cases/${caseId}/requirements/documents`)
    .set(adminHeadersWithoutMfa)
    .send(documentRequestBody);
  expect(response.status).toBe(403);
});

it("returns the same lifecycle shape for applications and certificates", async () => {
  const application = await request(app).get(`/api/v1/application/${ticketNo}`).set(customerHeaders);
  const certificate = await request(app).get(`/api/v1/certificate/${requestNo}`).set(customerHeaders);
  for (const response of [application, certificate]) {
    expect(response.body.lifecycle).toEqual(expect.objectContaining({
      case: expect.any(Object),
      timeline: expect.any(Array),
      requirements: expect.any(Array),
      availableActions: expect.any(Array),
    }));
  }
});
```

- [ ] **Step 2: Run route tests and confirm 404/missing-route failures**

Run: `npm test -- src/modules/cases/case.route.test.ts`

Expected: FAIL because case routes are not mounted.

- [ ] **Step 3: Implement strict schemas**

Use `.strict()` on every object. Common command fields:

```ts
const commandBase = z.object({
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(100),
}).strict();

export const messageSchema = commandBase.extend({
  message: z.string().trim().min(1).max(2000),
}).strict();

export const rejectSchema = commandBase.extend({
  reason: z.string().trim().min(5).max(1000),
}).strict();
```

Document labels accept one to twenty unique entries. Payment amounts accept positive safe integer paise within the configured maximum. Asset IDs use UUID validation.

- [ ] **Step 4: Mount case routes with role and MFA middleware**

Mount `app.use("/api/v1/cases", caseRouter)`. Apply `authenticate` to the router. Apply ownership in customer controllers and `authorize("ADMIN", "COADMIN")` plus `requireAdminMfa` to administrator commands. Add an `ADMIN` check to close.

- [ ] **Step 5: Adapt creation and detail controllers**

Create the domain record, `RequestCase`, and `CASE_SUBMITTED` in one Prisma transaction. Replace detail timeline composition with `serializeLifecycle`. Keep legacy route names but restrict legacy update endpoints to text messages that delegate to `postMessage`.

- [ ] **Step 6: Run routes, controllers, and type-check**

Run:

```powershell
npm test -- src/modules/cases/case.route.test.ts src/app.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit API routes and compatibility layer**

```powershell
git add server/src/modules/cases server/src/controller server/src/routes server/src/app.ts
git commit -m "Expose shared case lifecycle API"
```

---

### Task 8: Add API Integration Coverage for Both Request Types

**Files:**
- Create: `server/src/modules/cases/caseLifecycle.integration.test.ts`
- Create: `server/src/modules/cases/caseFixtures.ts`

**Interfaces:**
- Consumes all API interfaces from Tasks 1 through 7
- Produces a shared contract test that runs once for `APPLICATION` and once for `CERTIFICATE`

- [ ] **Step 1: Write the end-to-end lifecycle contract test**

```ts
it.each(["APPLICATION", "CERTIFICATE"] as const)("completes the %s lifecycle", async (type) => {
  const created = await fixtures.createRequest(type, owner);
  const reviewed = await commands.startReview(created.case, admin);
  const documents = await commands.requestDocuments(reviewed.case, admin, ["IDENTITY"]);
  await commands.postMessage(documents.case, owner, "Can I upload this tomorrow?");
  const submitted = await commands.submitDocuments(documents.case, owner, documents.requirement, identityAsset);
  const payment = await commands.requestPayment(submitted.case, admin, 10000);
  const settled = await fixtures.settleCharge(payment.charge);
  const approved = await commands.approve(settled.case, admin);
  const delivered = await commands.attachDeliverable(approved.case, admin, finalAsset(type));
  const completed = await commands.complete(delivered.case, admin);
  const closed = await commands.close(completed.case, masterAdmin);

  expect(closed.case.status).toBe("CLOSED");
  expect(closed.timeline.map((event) => event.type)).toEqual(expect.arrayContaining([
    "CASE_SUBMITTED", "REVIEW_STARTED", "DOCUMENTS_REQUESTED", "USER_MESSAGE",
    "DOCUMENTS_SUBMITTED", "PAYMENT_REQUESTED", "PAYMENT_CONFIRMED",
    "CASE_APPROVED", "DELIVERABLE_ATTACHED", "CASE_COMPLETED", "CASE_CLOSED",
  ]));
});
```

- [ ] **Step 2: Add security and race cases**

Add tests for foreign customer access returning `404`, forged events returning `400`, stale versions returning `409`, duplicate idempotency keys creating one event, completion with open requirements returning `409`, and rejected/closed cases refusing all mutations.

- [ ] **Step 3: Run database integration tests after Docker approval**

Run:

```powershell
cd D:\LegalDhara\repos\api\server
npx prisma migrate reset --force
npm test -- src/modules/cases/caseLifecycle.integration.test.ts
```

Expected: both request types pass the same lifecycle contract.

- [ ] **Step 4: Run the full API checkpoint**

Ask the user to run:

```powershell
cd D:\LegalDhara\repos\api\server
npm test
npm run typecheck
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit integration coverage**

```powershell
git add server/src/modules/cases
git commit -m "Test shared request lifecycle end to end"
```

---

### Task 9: Migrate the Admin Application and Certificate Controls

**Files:**
- Create: `../admin/src/features/cases/types.ts`
- Create: `../admin/src/features/cases/api.ts`
- Create: `../admin/src/features/cases/CaseActions.tsx`
- Create: `../admin/src/features/cases/CaseActions.test.tsx`
- Create: `../admin/src/features/cases/CaseTimeline.tsx`
- Create: `../admin/src/features/cases/CaseRequirements.tsx`
- Modify: `../admin/src/Store/ApplicationSlice/index.ts`
- Modify: `../admin/src/Store/CertSlice/index.ts`
- Modify: `../admin/src/pages/Applications.tsx`
- Modify: `../admin/src/pages/Certificates.tsx`
- Modify: `../admin/src/components/ApplicationDetailsSidebar.tsx`
- Modify: `../admin/src/components/AdminCertificateModal.tsx`

**Interfaces:**
- Consumes API `LifecycleResponse` and case command endpoints
- Produces typed `caseApi` methods and reusable case UI components
- Admin components render only actions returned in `availableActions`

- [ ] **Step 1: Write failing action-rendering tests**

```tsx
it("renders only server-approved actions", async () => {
  render(<CaseActions lifecycle={lifecycle({ availableActions: ["REQUEST_DOCUMENTS", "REJECT"] })} />);
  expect(screen.getByRole("button", { name: /request documents/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
});

it("submits the current case version and idempotency key", async () => {
  await user.click(screen.getByRole("button", { name: /start review/i }));
  expect(caseApi.startReview).toHaveBeenCalledWith(caseId, expect.objectContaining({
    expectedVersion: 3,
    idempotencyKey: expect.any(String),
  }));
});
```

- [ ] **Step 2: Run the component test and confirm missing-component failure**

Run: `npm test -- src/features/cases/CaseActions.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Add shared admin types and API methods**

Define exact unions matching the API. Implement methods for review, message, document request, payment request, requirement cancel, approve, reject, deliverable, complete, and close through `secureApi`.

- [ ] **Step 4: Build reusable timeline, requirements, and action components**

Render event labels from a fixed map. Render open requirements separately. Generate one idempotency key per submitted action and disable the relevant control while the request is pending. On `409`, refresh details and show “This request changed. Review the latest status and try again.”

- [ ] **Step 5: Replace arbitrary status controls in both admin flows**

Remove payload fields for status, event type, pending flags, payment result, and timeline metadata from application and certificate mutations. Refresh the shared lifecycle after every successful command.

- [ ] **Step 6: Run focused admin tests**

Run:

```powershell
cd D:\LegalDhara\repos\admin
npm test -- src/features/cases/CaseActions.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Ask the user to run full admin validation**

```powershell
npm test
npm run lint
npm run build
```

Expected: tests and build pass; lint has zero errors.

- [ ] **Step 8: Commit the admin migration**

```powershell
git add src
git commit -m "Use shared request lifecycle in admin"
```

---

### Task 10: Migrate the Customer Application and Certificate Views

**Files:**
- Create: `../website/lib/cases.ts`
- Create: `../website/lib/cases.test.ts`
- Create: `../website/components/cases/CaseTimeline.tsx`
- Create: `../website/components/cases/CaseRequirements.tsx`
- Create: `../website/components/cases/CaseReplyForm.tsx`
- Create: `../website/components/cases/caseFlows.test.tsx`
- Modify: `../website/app/dashboard/page.tsx`
- Modify: `../website/components/CertificateDetailsModel.tsx`
- Modify: `../website/components/CertificateApplication.tsx`

**Interfaces:**
- Consumes the shared lifecycle read contract and customer command endpoints
- Reuses `RazorpayCheckout` with the open payment requirement charge ID
- Uploads assets through existing managed upload APIs, then submits asset IDs to the document requirement

- [ ] **Step 1: Write failing customer flow tests**

```tsx
it("shows document and payment requirements at the same time", () => {
  render(<CaseRequirements lifecycle={lifecycleWithDocumentAndPayment()} />);
  expect(screen.getByText("Identity documents")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /pay now/i })).toBeInTheDocument();
});

it("keeps text replies available during ACTION_REQUIRED", () => {
  render(<CaseReplyForm lifecycle={lifecycle({ status: "ACTION_REQUIRED", availableActions: ["POST_MESSAGE"] })} />);
  expect(screen.getByRole("textbox", { name: /message/i })).toBeEnabled();
});

it("hides every mutation control for a closed case", () => {
  render(<CaseRequirements lifecycle={lifecycle({ status: "CLOSED", availableActions: [] })} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run customer flow tests and confirm missing-component failure**

Run: `npm test -- components/cases/caseFlows.test.tsx lib/cases.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add typed customer API methods**

Implement `postCaseMessage`, `submitRequirementDocuments`, and lifecycle parsers in `lib/cases.ts`. Require case id, expected version, and generated idempotency key. Keep all calls on `secureApi`.

- [ ] **Step 4: Build shared customer components**

Render fixed event labels, safe messages, timestamps, requirement state, and authorized asset links. Show upload controls only for open document requirements and checkout only for an open payment requirement. Show the reply form whenever `POST_MESSAGE` appears in `availableActions`.

- [ ] **Step 5: Replace old pending flag and status rendering**

Use `response.lifecycle` in both application and certificate detail views. Remove decisions based on `pendingDocs`, `pendingPayment`, old application updates, and old certificate updates. Keep list-card layout unchanged and map shared statuses to existing colors.

- [ ] **Step 6: Run focused website tests**

Run:

```powershell
cd D:\LegalDhara\repos\website
npm test -- components/cases/caseFlows.test.tsx lib/cases.test.ts components/payments/RazorpayCheckout.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Ask the user to run full website validation**

```powershell
npm test
npm run lint
npm run build
```

Expected: tests and build pass; lint has zero errors.

- [ ] **Step 8: Commit the website migration**

```powershell
git add app/dashboard/page.tsx components/CertificateApplication.tsx components/CertificateDetailsModel.tsx components/cases lib/cases.ts lib/cases.test.ts
git commit -m "Use shared request lifecycle on website"
```

---

### Task 11: Remove Legacy Lifecycle Writes and Fields

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_remove_legacy_request_lifecycle/migration.sql`
- Modify: `server/src/controller/application.controller.ts`
- Modify: `server/src/controller/certificate.controller.ts`
- Modify: `server/src/zodSchema/application.schema.ts`
- Modify: `server/src/zodSchema/certificate.schema.ts`
- Modify: `server/src/modules/cases/caseModel.test.ts`
- Modify: `server/src/modules/cases/caseLifecycle.integration.test.ts`

**Interfaces:**
- Removes `ApplicationUpdate`, `CertificateUpdate`, old lifecycle status columns, pending flags, and client-controlled update schemas after Tasks 9 and 10 stop consuming them
- Keeps application/certificate domain identifiers and specialized fields

- [ ] **Step 1: Extend the schema contract test to reject legacy lifecycle storage**

```ts
it("removes duplicate lifecycle storage", () => {
  expect(schema).not.toContain("model ApplicationUpdate {");
  expect(schema).not.toContain("model CertificateUpdate {");
  expect(schema).not.toContain("applicationStatus ApplicationStatus");
  expect(schema).not.toContain("status         CertificateRequestStatus");
  expect(schema).not.toContain("pendingPayment Boolean");
  expect(schema).not.toContain("pendingDocs");
  expect(schema).not.toContain("docRequired    Boolean");
});
```

- [ ] **Step 2: Run the model test and confirm legacy-field failure**

Run: `npm test -- src/modules/cases/caseModel.test.ts`

Expected: FAIL while old models and flags remain.

- [ ] **Step 3: Remove direct legacy writes from controllers and schemas**

Delete branches that accept client status, event type, charges, pending flags, payment result, or arbitrary metadata. Keep compatibility update routes as message-only delegates until a later API version removes them.

- [ ] **Step 4: Create the cleanup migration after Docker approval**

Run:

```powershell
npx prisma migrate dev --name remove_legacy_request_lifecycle --create-only
npx prisma generate
```

Because production workflow data is empty, drop legacy update tables and lifecycle columns directly. Do not drop `PaymentCharge`, payment attempts, uploaded assets, notifications, or domain identifiers.

- [ ] **Step 5: Run API lifecycle and payment regression suites**

Run:

```powershell
npm test -- src/modules/cases src/modules/payments
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit legacy cleanup**

```powershell
git add server/prisma server/src/controller server/src/zodSchema server/src/modules/cases
git commit -m "Remove duplicate request lifecycle state"
```

---

### Task 12: Validate Local Rollout and Prepare Deployment

**Files:**
- Modify: `docs/deployment.md`
- Create: `server/src/deployment/caseLifecycleContract.test.ts`
- Modify: `docs/superpowers/specs/2026-10-06-group-6-shared-request-lifecycle-design.md` only if implementation changed an approved interface

**Interfaces:**
- Produces deployment ordering and rollback instructions
- Produces a static deployment contract that checks migration, route mounting, outbox worker, and frontend compatibility markers

- [ ] **Step 1: Add the deployment contract test**

```ts
it("ships lifecycle migrations, routes, and email worker", () => {
  expect(readFileSync("src/app.ts", "utf8")).toContain('app.use("/api/v1/cases", caseRouter)');
  expect(readFileSync("src/index.ts", "utf8")).toContain("processCaseEmailOutbox");
  expect(readdirSync("prisma/migrations").some((name) => name.endsWith("_shared_request_lifecycle"))).toBe(true);
  expect(readdirSync("prisma/migrations").some((name) => name.endsWith("_remove_legacy_request_lifecycle"))).toBe(true);
});
```

- [ ] **Step 2: Document rollout order and rollback**

Add these exact phases to `docs/deployment.md`:

1. Back up PostgreSQL.
2. Deploy API image and run `prisma migrate deploy` before accepting new workflow traffic.
3. Verify `/health`, case route authentication, and outbox worker logs.
4. Deploy admin and run one administrator lifecycle smoke test.
5. Deploy website and run one customer lifecycle smoke test.
6. Roll back frontend builds first if a UI-only issue occurs.
7. Keep traffic paused while validating the destructive cleanup migration.
8. If validation fails before traffic resumes, restore the database backup and previous API/frontend images together.
9. After traffic resumes, roll forward with a corrected Group 6 API image; do not run the pre-Group 6 API against the cleaned schema.

- [ ] **Step 3: Ask the user to start Docker and run API validation**

```powershell
cd D:\LegalDhara\repos\api\server
npx prisma migrate reset --force
npm test
npm run typecheck
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 4: Ask the user to run admin validation**

```powershell
cd D:\LegalDhara\repos\admin
npm test
npm run lint
npm run build
```

Expected: tests and build pass; lint has zero errors.

- [ ] **Step 5: Ask the user to run website validation**

```powershell
cd D:\LegalDhara\repos\website
npm test
npm run lint
npm run build
```

Expected: tests and build pass; lint has zero errors.

- [ ] **Step 6: Run local smoke tests**

Test one application and one certificate through:

`SUBMITTED -> UNDER_REVIEW -> ACTION_REQUIRED -> UNDER_REVIEW -> APPROVED -> COMPLETED -> CLOSED`

For each request, verify a text reply during `ACTION_REQUIRED`, a document upload, a Razorpay test payment, in-app notifications, email outbox delivery, authorized final deliverable access, immutable event order, and no duplicate event after a repeated request.

- [ ] **Step 7: Commit deployment documentation**

```powershell
git add docs/deployment.md server/src/deployment/caseLifecycleContract.test.ts
git commit -m "Document shared lifecycle rollout"
```

- [ ] **Step 8: Review commit boundaries before push**

Run in each repository:

```powershell
git status --short
git log --oneline --decorate -12
git diff origin/main...HEAD --check
```

Expected: only Group 6 files are committed, no environment files or secrets are present, and unrelated generated sitemap/design files remain excluded.
