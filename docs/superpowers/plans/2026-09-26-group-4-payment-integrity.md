# Group 4 Payment Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated PhonePe/Razorpay payment flows with one Razorpay-only, charge-bound, idempotent, reconcilable payment system with full-refund support.

**Architecture:** Immutable `PaymentCharge` records define what is owed; `PaymentAttempt` records represent Razorpay orders; webhook, browser confirmation, reconciliation, and refund events converge on one transactional settlement service. Small target adapters update applications, certificates, or plans without allowing payment logic to rewrite final domain states.

**Tech Stack:** Express 5, TypeScript, Prisma/PostgreSQL, Razorpay Node SDK, Zod 4, node-cron, Vitest/Supertest, React 18/19, Next.js 15, Redux Toolkit, Axios.

**Spec:** `docs/superpowers/specs/2026-09-26-group-4-payment-integrity-design.md`

## Global Constraints

- Preserve all uncommitted Group 1 through Group 3 work.
- Do not commit, push, or deploy; integration remains deferred until all groups and local credential-based testing are complete.
- Razorpay is the only active payment gateway. Remove active PhonePe routes and client calls.
- The server derives amount, currency, category, and target. Clients never submit authoritative payment amounts.
- Store money as integer currency subunits (`amountMinor`) and use `INR` initially.
- A successful payment is terminal and cannot be overwritten by failed, pending, authorized, expired, or late events.
- Only primary `ADMIN` with current MFA may refund or manually reconcile payments.
- Refunds are full only.
- Payment records must survive user, application, certificate, service, and plan deletion attempts.
- Provider credentials are not required for unit tests; use injected Razorpay adapters.

## File Structure

- `server/src/modules/payments/types.ts`: payment-domain input/output contracts and provider-neutral states.
- `server/src/modules/payments/repository.ts`: Prisma repository and transaction interfaces.
- `server/src/modules/payments/chargeService.ts`: server-owned charge creation and cancellation.
- `server/src/modules/payments/attemptService.ts`: Razorpay order creation, reuse, retry, and failure cleanup.
- `server/src/modules/payments/settlementService.ts`: idempotent webhook/reconciliation state transitions.
- `server/src/modules/payments/targetAdapters.ts`: guarded application, certificate, and plan effects.
- `server/src/modules/payments/reconciliationService.ts`: stale-attempt provider checks and database lease.
- `server/src/modules/payments/refundService.ts`: full-refund request and confirmation lifecycle.
- `server/src/modules/payments/razorpayGateway.ts`: narrow adapter around the Razorpay SDK.
- `server/src/modules/payments/payment.controller.ts`: authenticated HTTP translation only.
- `server/src/modules/payments/payment.route.ts`: owner/admin payment APIs.
- `server/src/modules/payments/razorpayWebhook.route.ts`: exact raw-body webhook endpoint.
- `website/lib/payments.ts`: typed checkout/status API client.
- `website/components/payments/RazorpayCheckout.tsx`: reusable Razorpay checkout launcher.
- `admin/src/features/payments/*`: typed payment list, detail, reconciliation, and refund UI.

---

### Task 1: Replace the Ambiguous Payment Schema

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260926220000_group4_payment_integrity/migration.sql`
- Create: `server/src/modules/payments/paymentModel.test.ts`

**Interfaces:**
- Produces Prisma models `PaymentCharge`, `PaymentAttempt`, `PaymentWebhookEvent`, `PaymentRefund`, and `ScheduledJobLease`.
- Produces enums `PaymentChargeStatus`, `PaymentAttemptStatus`, `PaymentRefundStatus`, `PaymentWebhookStatus`, `PaymentTargetType`, `PaymentCategory`, and `PaymentGateway`.

- [ ] **Step 1: Write a failing schema-contract test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("payment integrity schema", () => {
  it("stores immutable charges, attempts, events, refunds, and a scheduler lease", () => {
    for (const model of ["PaymentCharge", "PaymentAttempt", "PaymentWebhookEvent", "PaymentRefund", "ScheduledJobLease"]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).not.toMatch(/model Payment \{/);
    expect(schema).not.toMatch(/Payment.*onDelete: Cascade/);
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/paymentModel.test.ts --pool=forks`

Expected: FAIL because the new models do not exist and legacy `Payment` remains.

- [ ] **Step 3: Add the Prisma models and relations**

Use these core fields consistently:

```prisma
model PaymentCharge {
  id                         String              @id @default(uuid()) @db.Uuid
  userId                     String              @db.Uuid
  targetType                 PaymentTargetType
  applicationId              String?             @db.Uuid
  certificateRequestId       String?             @db.Uuid
  planId                     String?             @db.Uuid
  sourceApplicationUpdateId  String?             @unique @db.Uuid
  sourceCertificateUpdateId  String?             @unique @db.Uuid
  category                   PaymentCategory
  amountMinor                Int
  currency                   String              @default("INR")
  purpose                    String
  status                     PaymentChargeStatus @default(OPEN)
  paidAttemptId              String?             @unique @db.Uuid
  paidAt                     DateTime?
  refundedAt                 DateTime?
  cancelledAt                DateTime?
  createdAt                  DateTime            @default(now())
  updatedAt                  DateTime            @updatedAt
  attempts                   PaymentAttempt[]    @relation("ChargeAttempts")
  paidAttempt                PaymentAttempt?     @relation("PaidAttempt", fields: [paidAttemptId], references: [id], onDelete: SetNull)
  refunds                    PaymentRefund[]
  user                       User                @relation(fields: [userId], references: [id], onDelete: Restrict)
  application                Application?        @relation(fields: [applicationId], references: [id], onDelete: Restrict)
  certificateRequest         CertificateRequest? @relation(fields: [certificateRequestId], references: [id], onDelete: Restrict)
  plan                       Plan?               @relation(fields: [planId], references: [id], onDelete: Restrict)
}

model PaymentAttempt {
  id                    String               @id @default(uuid()) @db.Uuid
  chargeId              String               @db.Uuid
  gateway               PaymentGateway       @default(RAZORPAY)
  status                PaymentAttemptStatus @default(CREATING)
  amountMinor           Int
  currency              String               @default("INR")
  gatewayOrderId        String?              @unique
  gatewayPaymentId      String?              @unique
  paymentMethod         String?
  failureCode           String?
  failureDescription    String?
  gatewayResponse       Json?
  expiresAt             DateTime
  settledAt             DateTime?
  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt
  charge                PaymentCharge        @relation("ChargeAttempts", fields: [chargeId], references: [id], onDelete: Restrict)
  settledCharge         PaymentCharge?        @relation("PaidAttempt")
  webhookEvents         PaymentWebhookEvent[]
  refund                PaymentRefund?
}

model PaymentWebhookEvent {
  id                 String               @id @default(uuid()) @db.Uuid
  eventKey           String               @unique
  providerEventId    String?
  payloadDigest      String
  eventType          String
  gatewayOrderId     String?
  gatewayPaymentId   String?
  attemptId          String?              @db.Uuid
  status             PaymentWebhookStatus @default(RECEIVED)
  failureReason      String?
  receivedAt         DateTime             @default(now())
  processedAt        DateTime?
  attempt            PaymentAttempt?      @relation(fields: [attemptId], references: [id], onDelete: SetNull)
}

model PaymentRefund {
  id                 String              @id @default(uuid()) @db.Uuid
  chargeId           String              @db.Uuid
  attemptId          String              @unique @db.Uuid
  requestedBy        String              @db.Uuid
  amountMinor        Int
  currency           String              @default("INR")
  status             PaymentRefundStatus @default(REQUESTED)
  reason             String
  gatewayRefundId    String?             @unique
  gatewayResponse    Json?
  requestedAt        DateTime            @default(now())
  processedAt        DateTime?
  updatedAt          DateTime            @updatedAt
  charge             PaymentCharge       @relation(fields: [chargeId], references: [id], onDelete: Restrict)
  attempt            PaymentAttempt      @relation(fields: [attemptId], references: [id], onDelete: Restrict)
  requestedByAdmin   User                @relation(fields: [requestedBy], references: [id], onDelete: Restrict)
}

model ScheduledJobLease {
  name               String   @id
  holderId           String
  expiresAt          DateTime
  updatedAt          DateTime @updatedAt
}
```

Add raw migration constraints:

```sql
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_one_target"
CHECK (num_nonnulls("applicationId", "certificateRequestId", "planId") = 1);
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_positive_amount" CHECK ("amountMinor" > 0);
CREATE UNIQUE INDEX "PaymentAttempt_one_open_per_charge"
ON "PaymentAttempt" ("chargeId")
WHERE status IN ('CREATING', 'PENDING', 'AUTHORIZED');
```

Remove legacy cascade payment relations, replace update/payment links with charge links, and add `deletedAt` or cancellation fields required by soft-delete flows.

- [ ] **Step 4: Generate Prisma and run the contract test**

Run: `npx prisma generate`

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/paymentModel.test.ts --pool=forks`

Expected: PASS.

---

### Task 2: Implement Charge Creation and Ownership

**Files:**
- Create: `server/src/modules/payments/types.ts`
- Create: `server/src/modules/payments/repository.ts`
- Create: `server/src/modules/payments/chargeService.test.ts`
- Create: `server/src/modules/payments/chargeService.ts`

**Interfaces:**
- Produces `createCharge(input, deps)`, `getOwnedCharge(input, deps)`, and `cancelOpenCharge(input, deps)`.
- `createCharge` consumes server-derived `{ userId, target, category, amountMinor, currency, purpose, sourceUpdateId? }` and never accepts a request body directly.

- [ ] **Step 1: Write failing ownership and immutability tests**

```ts
it("returns not found when another customer reads the charge", async () => {
  repository.findCharge.mockResolvedValue(charge({ userId: "user-2" }));
  await expect(getOwnedCharge({ chargeId: "charge-1", actor: userOne }, deps))
    .rejects.toMatchObject({ statusCode: 404 });
});

it("creates the exact server-calculated amount", async () => {
  await createCharge({
    userId: "user-1",
    target: { type: "APPLICATION", applicationId: "app-1" },
    category: "INITIAL",
    amountMinor: 125000,
    currency: "INR",
    purpose: "Initial application charge",
  }, deps);
  expect(repository.createCharge).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 125000 }));
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/chargeService.test.ts --pool=forks`

Expected: FAIL because the charge service does not exist.

- [ ] **Step 3: Implement domain errors and charge rules**

Define `PaymentDomainError(message, statusCode, code)`. Validate one target, positive integer minor units, `INR`, bounded purpose, owner-safe lookup, immutable financial fields, and valid cancellation only while `OPEN` with no successful attempt.

- [ ] **Step 4: Run the focused test**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/chargeService.test.ts --pool=forks`

Expected: PASS.

---

### Task 3: Create and Retry Razorpay Attempts Safely

**Files:**
- Create: `server/src/modules/payments/razorpayGateway.ts`
- Create: `server/src/modules/payments/attemptService.test.ts`
- Create: `server/src/modules/payments/attemptService.ts`
- Modify: `server/src/services/Razorpay.ts`

**Interfaces:**
- Produces `createOrReuseAttempt({ chargeId, actor }, deps)`.
- Produces gateway interface `createOrder`, `fetchOrder`, `fetchPayment`, `createFullRefund`, and `verifyWebhook`.

- [ ] **Step 1: Write failing reuse and cleanup tests**

```ts
it("reuses the existing pending Razorpay order", async () => {
  repository.findReusableAttempt.mockResolvedValue(attempt({ gatewayOrderId: "order_1", status: "PENDING" }));
  await expect(createOrReuseAttempt(input, deps)).resolves.toMatchObject({ gatewayOrderId: "order_1" });
  expect(gateway.createOrder).not.toHaveBeenCalled();
});

it("marks a creating attempt failed when Razorpay rejects order creation", async () => {
  gateway.createOrder.mockRejectedValue(new Error("provider unavailable"));
  await expect(createOrReuseAttempt(input, deps)).rejects.toMatchObject({ statusCode: 502 });
  expect(repository.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({ attemptId: "attempt-1" }));
  expect(repository.expireOtherAttempts).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/attemptService.test.ts --pool=forks`

Expected: FAIL because the attempt service is missing.

- [ ] **Step 3: Implement the narrow Razorpay adapter and attempt workflow**

Create the internal attempt first, call Razorpay with `amountMinor`, `INR`, receipt `attempt.id`, and notes containing only `attemptId`, `chargeId`, and target type. On success persist `gatewayOrderId` and `PENDING`; on known failure persist `FAILED`; expire older attempts only after the replacement is durable.

- [ ] **Step 4: Run attempt tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/attemptService.test.ts --pool=forks`

Expected: PASS.

---

### Task 4: Implement Idempotent Settlement and Target Adapters

**Files:**
- Create: `server/src/modules/payments/settlementService.test.ts`
- Create: `server/src/modules/payments/settlementService.ts`
- Create: `server/src/modules/payments/targetAdapters.test.ts`
- Create: `server/src/modules/payments/targetAdapters.ts`
- Modify: `server/src/controller/application.controller.ts`
- Modify: `server/src/controller/certificate.controller.ts`
- Modify: `server/src/controller/plan.contoller.ts`

**Interfaces:**
- Produces `settleProviderPayment(input, deps)` and `recordProviderFailure(input, deps)`.
- Produces adapter contract `applyPaidCharge(charge, transaction)`.

- [ ] **Step 1: Write failing monotonic/idempotency tests**

```ts
it("settles one matching captured payment exactly once", async () => {
  const first = await settleProviderPayment(captured, deps);
  const second = await settleProviderPayment(captured, deps);
  expect(first.outcome).toBe("SETTLED");
  expect(second.outcome).toBe("ALREADY_SETTLED");
  expect(target.applyPaidCharge).toHaveBeenCalledTimes(1);
});

it("rejects an amount mismatch without advancing the target", async () => {
  await expect(settleProviderPayment({ ...captured, amountMinor: 100 }, deps))
    .rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  expect(target.applyPaidCharge).not.toHaveBeenCalled();
});

it("records a second captured attempt without advancing the target twice", async () => {
  repository.findChargeForUpdate.mockResolvedValue(charge({ status: "PAID", paidAttemptId: "attempt-1" }));
  await expect(settleProviderPayment({ ...captured, attemptId: "attempt-2" }, deps))
    .resolves.toMatchObject({ outcome: "DUPLICATE_SUCCESS" });
  expect(target.applyPaidCharge).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/settlementService.test.ts src/modules/payments/targetAdapters.test.ts --pool=forks`

Expected: FAIL because settlement and adapters do not exist.

- [ ] **Step 3: Implement transactional conditional transitions**

Match order ID, payment ID, amount, currency, and captured state. Use conditional updates or row locks so only one transaction changes an `OPEN` charge to `PAID`. Keep `SUCCESS` terminal. Map provider `authorized` to `AUTHORIZED`, provider failures to `FAILED`, and unresolved states to `PENDING`.

- [ ] **Step 4: Implement guarded target adapters**

Application/certificate adapters clear only the exact charge requirement and refuse to regress final states. Plan adapter creates or extends `UserPlan`, links the successful attempt, and leaves plan-benefit enforcement to Group 5. Move notification creation inside the first-settlement transaction and external delivery after commit.

- [ ] **Step 5: Run settlement and adapter tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/settlementService.test.ts src/modules/payments/targetAdapters.test.ts --pool=forks`

Expected: PASS.

---

### Task 5: Mount a Correct Raw-body Razorpay Webhook

**Files:**
- Create: `server/src/modules/payments/razorpayWebhook.route.test.ts`
- Create: `server/src/modules/payments/razorpayWebhook.route.ts`
- Create: `server/src/modules/payments/razorpayWebhook.controller.ts`
- Modify: `server/src/server.ts`
- Modify: `server/src/app.ts`
- Delete: `server/src/routes/phonepe.route.ts`
- Delete: `server/src/routes/razorpay.route.ts`
- Delete: `server/src/utils/callbacks.ts`

**Interfaces:**
- Consumes settlement service from Task 4.
- Produces `POST /api/v1/payments/webhooks/razorpay` before global JSON parsing.

- [ ] **Step 1: Write failing raw-body and duplicate-event tests**

```ts
it("validates the signature against exact raw bytes", async () => {
  await request(server).post("/api/v1/payments/webhooks/razorpay")
    .set("x-razorpay-signature", "valid")
    .set("x-razorpay-event-id", "event-1")
    .set("content-type", "application/json")
    .send('{"event":"payment.captured"}')
    .expect(200);
  expect(gateway.verifyWebhook).toHaveBeenCalledWith(expect.any(Buffer), "valid");
});

it("acknowledges a repeated event without settling twice", async () => {
  eventRepository.createOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await deliverWebhook();
  await deliverWebhook();
  expect(settlement.settleProviderPayment).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/razorpayWebhook.route.test.ts --pool=forks`

Expected: FAIL because the route is absent or JSON has already consumed the body.

- [ ] **Step 3: Mount raw middleware before `createApp()` JSON middleware**

Parse the verified Buffer only after signature validation. Deduplicate by Razorpay event ID or SHA-256 digest. Route captured/failed payment and refund events to the relevant domain service. Record unknown valid events and return `200`.

- [ ] **Step 4: Remove PhonePe and legacy callback mounting**

Remove `/phonepe/callback`, the old malformed Razorpay callback, and callback helpers. Keep no public provider-status endpoint.

- [ ] **Step 5: Run webhook tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/razorpayWebhook.route.test.ts --pool=forks`

Expected: PASS.

---

### Task 6: Add Reconciliation with a Database Lease

**Files:**
- Create: `server/src/modules/payments/reconciliationService.test.ts`
- Create: `server/src/modules/payments/reconciliationService.ts`
- Create: `server/src/modules/payments/reconciliationJob.ts`
- Modify: `server/src/server.ts`
- Delete: `server/src/cron/expirePayment.ts`

**Interfaces:**
- Produces `reconcileAttempt(attemptId, deps)`, `reconcileStaleAttempts(input, deps)`, `startPaymentReconciliationJob()`, and `stopPaymentReconciliationJob()`.

- [ ] **Step 1: Write failing recovery and lease tests**

```ts
it("recovers a captured payment whose webhook was missed", async () => {
  gateway.fetchOrder.mockResolvedValue({ id: "order-1", status: "paid", amount_paid: 50000, currency: "INR" });
  gateway.findCapturedPayment.mockResolvedValue({ id: "pay-1", order_id: "order-1", status: "captured", amount: 50000, currency: "INR" });
  await reconcileAttempt("attempt-1", deps);
  expect(settlement.settleProviderPayment).toHaveBeenCalledWith(expect.objectContaining({ gatewayPaymentId: "pay-1" }));
});

it("does not run a second batch while another lease is active", async () => {
  lease.acquire.mockResolvedValue(false);
  await reconcileStaleAttempts({ limit: 50 }, deps);
  expect(repository.findStaleAttempts).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/reconciliationService.test.ts --pool=forks`

Expected: FAIL because reconciliation does not exist.

- [ ] **Step 3: Implement bounded reconciliation**

Acquire a five-minute PostgreSQL lease, fetch at most 50 stale attempts, compare Razorpay order/payment state and exact amount/currency, and call Task 4 settlement functions. Expire only provider-confirmed failures or attempts beyond the configured maximum age. Store bounded retry metadata for ambiguous provider errors.

- [ ] **Step 4: Start and stop the schedule with the API**

Run every five minutes outside tests. Ensure shutdown stops future ticks and an overlapping run exits safely.

- [ ] **Step 5: Run reconciliation tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/reconciliationService.test.ts --pool=forks`

Expected: PASS.

---

### Task 7: Add Full Refunds and Administrative Recovery APIs

**Files:**
- Create: `server/src/modules/payments/refundService.test.ts`
- Create: `server/src/modules/payments/refundService.ts`
- Create: `server/src/modules/payments/payment.route.test.ts`
- Create: `server/src/modules/payments/payment.controller.ts`
- Create: `server/src/modules/payments/payment.route.ts`
- Modify: `server/src/app.ts`
- Delete: `server/src/routes/payment.route.ts`
- Delete: `server/src/controller/payment.controller.ts`

**Interfaces:**
- Produces `requestFullRefund({ attemptId, actorId, reason }, deps)` and `confirmRefund(input, deps)`.
- Produces owner-safe charge status/detail routes and ADMIN+MFA refund/reconcile routes.

- [ ] **Step 1: Write failing refund idempotency tests**

```ts
it("requests one full refund for a successful attempt", async () => {
  gateway.createFullRefund.mockResolvedValue({ id: "rfnd_1", status: "pending" });
  await requestFullRefund({ attemptId: "attempt-1", actorId: "admin-1", reason: "Duplicate payment" }, deps);
  await requestFullRefund({ attemptId: "attempt-1", actorId: "admin-1", reason: "Duplicate payment" }, deps);
  expect(gateway.createFullRefund).toHaveBeenCalledTimes(1);
});

it("does not change the valid paid charge when refunding a duplicate success", async () => {
  repository.findRefundableAttempt.mockResolvedValue(attempt({ status: "DUPLICATE_SUCCESS" }));
  await confirmRefund(processedRefund, deps);
  expect(repository.markChargeRefunded).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/refundService.test.ts --pool=forks`

Expected: FAIL because refund service is missing.

- [ ] **Step 3: Implement full-refund lifecycle**

Require `SUCCESS` or `DUPLICATE_SUCCESS`, a gateway payment ID, no processed/requested refund, and a bounded reason. Create `REQUESTED` before provider call. Persist Razorpay refund ID and `PENDING`; confirm through webhook/reconciliation; mark the paid charge `REFUNDED` only if the refunded attempt is `paidAttemptId`.

- [ ] **Step 4: Write failing route authorization/ownership tests**

```ts
it("returns 404 when one customer reads another customer's charge", async () => {
  await authenticatedRequest(userOne).get("/payments/charges/charge-2").expect(404);
});

it("blocks COADMIN from issuing a refund", async () => {
  await authenticatedRequest(coadmin).post("/payments/admin/attempts/attempt-1/refund")
    .send({ reason: "Duplicate payment" }).expect(403);
});
```

- [ ] **Step 5: Implement the route surface**

```text
POST /api/v1/payments/charges/:chargeId/attempts
POST /api/v1/payments/attempts/confirm
GET  /api/v1/payments/charges/:chargeId/status
GET  /api/v1/payments/charges/:chargeId
GET  /api/v1/payments/mine
GET  /api/v1/payments/admin
GET  /api/v1/payments/admin/:attemptId
POST /api/v1/payments/admin/:attemptId/reconcile
POST /api/v1/payments/admin/:attemptId/refund
```

Customer routes require ownership. Admin listing/detail require ADMIN or COADMIN plus MFA. Reconcile/refund require ADMIN plus MFA. Never return raw provider payloads.

- [ ] **Step 6: Run refund and route tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/refundService.test.ts src/modules/payments/payment.route.test.ts --pool=forks`

Expected: PASS.

---

### Task 8: Bind Application, Certificate, and Plan Flows to Charges

**Files:**
- Create: `server/src/modules/payments/domainChargeCreation.test.ts`
- Modify: `server/src/controller/application.controller.ts`
- Modify: `server/src/controller/certificate.controller.ts`
- Modify: `server/src/controller/plan.contoller.ts`
- Modify: `server/src/routes/application.route.ts`
- Modify: `server/src/routes/certificate.routes.ts`
- Modify: `server/src/routes/plan.route.ts`
- Modify: `server/src/zodSchema/payment.schema.ts`

**Interfaces:**
- Consumes `createCharge` from Task 2.
- Produces domain responses containing `chargeId`, display amount, currency, and purpose.

- [ ] **Step 1: Write failing domain charge tests**

```ts
it("ignores a customer-supplied application amount", async () => {
  await createInitialApplication({ body: { serviceId: "service-1", amount: 1 }, auth: userOne } as any, response);
  expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 125000 }), expect.anything());
});

it("binds an admin-requested certificate charge to its exact update", async () => {
  await requestCertificatePayment(validAdminRequest, response);
  expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({ sourceUpdateId: "update-1", category: "ADDITIONAL" }), expect.anything());
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/domainChargeCreation.test.ts --pool=forks`

Expected: FAIL because controllers create legacy payment rows or trust request amounts.

- [ ] **Step 3: Replace all legacy initiation handlers**

Create initial/additional/plan charges transactionally from server prices. Remove `/application/pay`, `/application/create-order`, `/certificate/pay`, `/certificate/create-order`, `/plan/buy`, and `/plan/create-order` payment-initiation behavior. Domain endpoints create/return charges; Task 7 starts attempts.

- [ ] **Step 4: Replace hard delete with soft cancellation**

Fix ticket-number parameter use, set `deletedAt`/cancelled state, refuse cancellation of finalized cases, and retain all payment charge/attempt/refund rows.

- [ ] **Step 5: Run domain tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments/domainChargeCreation.test.ts --pool=forks`

Expected: PASS.

---

### Task 9: Migrate the Website to Razorpay Charge Checkout

**Files:**
- Create: `website/lib/payments.test.ts`
- Create: `website/lib/payments.ts`
- Create: `website/components/payments/RazorpayCheckout.test.tsx`
- Create: `website/components/payments/RazorpayCheckout.tsx`
- Modify: `website/components/OnboardingClient.tsx`
- Modify: `website/app/dashboard/page.tsx`
- Modify: `website/components/CertificateDetailsModel.tsx`
- Modify: `website/app/pricing/page.tsx`
- Modify: `website/app/payment/response/page.tsx`
- Delete: `website/app/demo/page.tsx`
- Delete: `website/config/initiateRazorpayPayment.ts`

**Interfaces:**
- Produces `startPaymentAttempt(chargeId)`, `confirmCheckout(input)`, `getChargeStatus(chargeId)`, and reusable `<RazorpayCheckout chargeId onComplete />`.

- [ ] **Step 1: Write failing API-client contract tests**

```ts
it("starts checkout with only a charge ID", async () => {
  await startPaymentAttempt("charge-1");
  expect(post).toHaveBeenCalledWith("/api/v1/payments/charges/charge-1/attempts");
});

it("does not send client amount or payment category", async () => {
  await startPaymentAttempt("charge-1");
  expect(JSON.stringify(post.mock.calls)).not.toMatch(/amount|paymentType/);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run lib/payments.test.ts components/payments/RazorpayCheckout.test.tsx --pool=forks`

Expected: FAIL because the charge checkout client does not exist.

- [ ] **Step 3: Implement typed Razorpay checkout**

Load checkout script only when needed. Open with server-returned order ID, amount, currency, and key ID. Post only Razorpay order/payment/signature values to confirmation. Route to `/payment/response?chargeId=<uuid>` without success/amount claims.

- [ ] **Step 4: Replace all website payment starts and result rendering**

Application, certificate, and plan flows consume returned `chargeId`. The result page polls authenticated charge status and renders success only for `PAID`; `OPEN`/`PROCESSING` remains pending; `FAILED_RETRYABLE` offers retry.

- [ ] **Step 5: Remove PhonePe and demo code**

Remove transaction-reference redirects, public status polling, PhonePe naming, and the production demo route.

- [ ] **Step 6: Run website payment tests**

Run: `.\node_modules\.bin\vitest.cmd run lib/payments.test.ts components/payments/RazorpayCheckout.test.tsx --pool=forks`

Expected: PASS.

---

### Task 10: Add Admin Payment Recovery and Full Refund UI

**Files:**
- Create: `admin/src/features/payments/types.ts`
- Create: `admin/src/features/payments/api.ts`
- Create: `admin/src/features/payments/PaymentActions.test.tsx`
- Create: `admin/src/features/payments/PaymentActions.tsx`
- Modify: `admin/src/Store/PaymentSlice/index.ts`
- Modify: `admin/src/pages/Payments.tsx`
- Modify: `admin/src/components/PaymentDetailModal.tsx`

**Interfaces:**
- Consumes Task 7 admin payment endpoints.
- Produces ADMIN-only reconcile and full-refund actions.

- [ ] **Step 1: Write failing action visibility and confirmation tests**

```tsx
it("hides refund and reconcile actions from COADMIN", () => {
  render(<PaymentActions role="COADMIN" attempt={staleSuccessfulAttempt} api={api} />);
  expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reconcile/i })).not.toBeInTheDocument();
});

it("requires a reason and confirmation for a full refund", async () => {
  render(<PaymentActions role="ADMIN" attempt={successfulAttempt} api={api} />);
  await user.click(screen.getByRole("button", { name: /refund/i }));
  await user.type(screen.getByLabelText(/reason/i), "Duplicate payment");
  await user.click(screen.getByRole("button", { name: /confirm full refund/i }));
  expect(api.refund).toHaveBeenCalledWith("attempt-1", { reason: "Duplicate payment" });
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `.\node_modules\.bin\vitest.cmd run src/features/payments/PaymentActions.test.tsx --pool=forks`

Expected: FAIL because the action component does not exist.

- [ ] **Step 3: Implement typed list/detail/action UI**

Display charge status separately from attempt/refund status. Show safe gateway order/payment IDs, target, amount, purpose, timestamps, failures, duplicate warnings, and reconciliation result. Require confirmation and reason for refunds. Refresh detail/list after mutations.

- [ ] **Step 4: Run admin payment tests**

Run: `.\node_modules\.bin\vitest.cmd run src/features/payments/PaymentActions.test.tsx --pool=forks`

Expected: PASS.

---

### Task 11: Remove PhonePe Dependencies and Document Operations

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/.env.example`
- Delete: `server/src/services/PhonePe.ts`
- Create: `server/docs/group-4-payment-operations.md`
- Modify: `website/.env.example` if present

**Interfaces:**
- Documents Razorpay keys, webhook secret, subscribed events, reconciliation schedule, refund permissions, migration order, and deferred test-mode checks.

- [ ] **Step 1: Prove no active PhonePe references remain**

Run: `rg -n "PhonePe|PHONEPE|phonepe|pg-sdk-node" server/src website/app website/components website/lib website/config`

Expected before cleanup: matches in active source.

- [ ] **Step 2: Remove PhonePe SDK and environment variables**

Run: `npm uninstall pg-sdk-node` in `server` after source references are removed. Remove `PHONEPE_*` values. Keep `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` placeholders empty.

- [ ] **Step 3: Write the operations guide**

Document test/live key separation, raw webhook path, required events, five-minute reconciliation, ADMIN-only refunds, alert handling, migration/deploy order, and deferred test-mode scenarios. Never include real keys.

- [ ] **Step 4: Re-run the source scan**

Run: `rg -n "PhonePe|PHONEPE|phonepe|pg-sdk-node" server/src website/app website/components website/lib website/config`

Expected: no active-source matches. Historical migration or bug-report text may remain outside those paths.

---

### Task 12: Full Regression and Build Verification

**Files:**
- Modify only files required by concrete failures in Group 4 code.

**Interfaces:**
- Verifies the complete Group 4 system while leaving commits, pushes, deployment, and real-gateway tests deferred.

- [ ] **Step 1: Run focused Group 4 API tests**

Run: `.\node_modules\.bin\vitest.cmd run src/modules/payments --pool=forks --maxWorkers=1`

Expected: all payment tests PASS.

- [ ] **Step 2: Run full API verification**

Run: `.\node_modules\.bin\vitest.cmd run --pool=forks --maxWorkers=1`

Run: `npm run typecheck`

Run: `npm run build`

Expected: 0 test failures and both static commands exit 0.

- [ ] **Step 3: Run full admin verification**

Run: `.\node_modules\.bin\vitest.cmd run --pool=forks --maxWorkers=1`

Run: `npx tsc -b --pretty false`

Run: `npm run build`

Run: `npm run lint`

Expected: tests, TypeScript, and build exit 0. Record the known repository-wide legacy lint baseline separately; do not fix unrelated files.

- [ ] **Step 4: Run full website verification**

Run: `.\node_modules\.bin\vitest.cmd run --pool=forks --maxWorkers=1`

Run: `npx tsc --noEmit`

Run: `npm run build` with temporary non-secret Firebase build placeholders if real public configuration is still deferred.

Expected: tests, TypeScript, and build exit 0. Network access may be required for the configured Google font.

- [ ] **Step 5: Run repository hygiene checks**

Run in API, admin, and website: `git diff --check` and `git status --short`.

Expected: no whitespace errors, no generated build artifacts tracked, and all Group 1 through Group 4 work remains uncommitted.

- [ ] **Step 6: Record deferred Razorpay integration checks**

Do not claim live integration is verified. Record that Razorpay test-mode checkout, raw webhook delivery, duplicate event delivery, missed-webhook reconciliation, duplicate success, and full refund require test credentials plus a reachable callback URL before commit/push/deployment.
