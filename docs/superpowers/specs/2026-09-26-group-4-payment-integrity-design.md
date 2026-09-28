# Group 4: Payment Integrity and Recording Design

## Scope

Group 4 resolves the following payment-integrity bugs:

- BUG-017: payment details are readable without an ownership check
- BUG-019: callbacks are not idempotent and can reverse final state
- BUG-021: failed application payments cannot be retried
- BUG-022: no double-payment guard or refund workflow
- BUG-028: deleting domain records cascades into payment-history deletion
- BUG-033: no reconciliation when a webhook is missed
- BUG-034: payments are not bound to one exact charge
- BUG-035: certificate retry cleanup targets the wrong relation
- BUG-036: pending gateway states are recorded as failed
- BUG-037: gateway start failures leave orphan pending rows and validation failures return 500

Razorpay is the only active payment gateway. PhonePe initiation, callback, status, and client flows are disabled rather than maintained in parallel. The first refund implementation supports full refunds only.

Group 5 remains responsible for broad payment-history presentation, revenue dashboards, invoices/GST, and plan-benefit rules. Group 6 remains responsible for replacing applications and certificates with one generic request lifecycle. This design provides narrow target adapters so the payment core can survive that later lifecycle migration.

## Design Principles

1. The server calculates every charge. Clients choose neither amount nor payment category.
2. A charge is immutable accounting intent; a gateway order is an attempt to settle that charge.
3. Webhooks, browser verification, reconciliation, and administrative repair all call one idempotent settlement service.
4. Money state is monotonic. A successful payment cannot become pending, failed, or expired.
5. Domain progression occurs only after an exact amount and currency match for the currently open charge.
6. Provider payloads are evidence, not authorization input and not customer-facing response data.
7. Payment and refund records are retained. Domain deletion must not erase accounting history.
8. Notifications and timeline side effects happen once, after the settlement transaction commits.

## Data Model

### PaymentCharge

`PaymentCharge` represents one exact obligation created by the server.

Fields:

- internal UUID
- owner `userId`
- exactly one target relation: `applicationId`, `certificateRequestId`, or `planId`
- optional source update relation for the application or certificate update that created the charge
- server-derived category: `INITIAL`, `ADDITIONAL`, `CORRECTION`, or `PLAN`
- immutable `amountMinor` integer in currency subunits
- currency, initially fixed to `INR`
- bounded purpose and safe display description
- status: `OPEN`, `PAID`, `REFUNDED`, or `CANCELLED`
- `paidAttemptId`, `paidAt`, `refundedAt`, and timestamps

Database checks enforce a positive amount and exactly one target. One source update can own at most one charge. Domain code may have only one `OPEN` charge requiring action at a time.

### PaymentAttempt

`PaymentAttempt` represents one Razorpay order used to settle one charge.

Fields:

- internal UUID used as the Razorpay receipt and included in provider notes
- `chargeId`
- gateway fixed to `RAZORPAY`
- status: `CREATING`, `PENDING`, `AUTHORIZED`, `SUCCESS`, `FAILED`, `EXPIRED`, or `DUPLICATE_SUCCESS`
- immutable expected amount and currency snapshot
- unique Razorpay order ID
- unique Razorpay payment ID when available
- payment method when confirmed
- safe failure code and description
- provider response JSON for restricted audit access
- creation, expiry, settlement, and update timestamps

Only one non-final attempt may exist per charge. The service reuses an existing open Razorpay order when possible rather than creating multiple payable links. A new order may be created only after the previous attempt is definitively failed or expired and the charge remains open.

### PaymentWebhookEvent

`PaymentWebhookEvent` records webhook delivery before processing:

- unique Razorpay event ID when supplied
- deterministic payload digest as a fallback deduplication key
- event type
- related order and payment IDs
- processing status and timestamps
- bounded failure reason

The unique event key prevents duplicate processing. Settlement still remains independently idempotent because different event IDs can describe the same payment state.

### PaymentRefund

`PaymentRefund` records one full refund per successful attempt:

- internal UUID
- attempt and charge IDs
- requested amount equal to the settled amount
- status: `REQUESTED`, `PENDING`, `PROCESSED`, or `FAILED`
- unique Razorpay refund ID
- requesting administrator ID and reason
- provider response and timestamps

A unique attempt relation prevents multiple full-refund requests. Refund processing changes the charge from `PAID` to `REFUNDED` only after Razorpay confirms the full refund.

### Retention

Payment relations use `Restrict` or `SetNull`, never `Cascade`. User, application, certificate, and plan deletion flows must soft-delete, cancel, or refuse deletion while accounting records exist. The broken application delete route becomes a soft-cancel operation and cannot delete a case that has settled financial records.

Because there are no production users or payment records, the migration can replace the current ambiguous `Payment` structure without a legacy-data backfill. Seed and test fixtures will use the new model directly.

## Charge Creation

### Initial Application Charge

Creating an authenticated application calculates the service price and government charge on the server and creates the application plus its initial `PaymentCharge` in one database transaction. The client receives the charge ID and display amount, not permission to submit an amount.

### Additional Application or Certificate Charge

When an administrator requests payment, the domain update and charge are created atomically. The charge links to that exact update and stores the requested amount permanently. Previous timeline rows are never edited. A user cannot create, modify, replace, or relabel a charge.

### Plan Charge

An authenticated user may create a plan charge using a plan ID. The server reads the current plan price and category. Plan benefits remain deferred to Group 5, but payment recording and later `UserPlan.paymentId` linkage use the settled charge and attempt.

All charge-creation schemas are strict. Amounts are validated as positive server-side values with a configured maximum. Invalid payloads return `400`, not `500`.

## Starting and Retrying Payment

The authenticated endpoint is:

`POST /api/v1/payments/charges/:chargeId/attempts`

The service verifies that the actor owns the charge, the charge is `OPEN`, and the target still accepts payment. It returns an existing usable Razorpay order if one exists.

For a new order:

1. Create a `CREATING` attempt with an internal UUID, amount snapshot, and expiry.
2. Call Razorpay Orders using the exact amount in paise, `INR`, the attempt UUID as receipt, and only internal IDs in notes.
3. If Razorpay succeeds, save the unique gateway order ID and set the attempt to `PENDING`.
4. If Razorpay fails, mark the attempt `FAILED` with a safe reason. The charge remains `OPEN` and can be retried.
5. Do not expire an older usable attempt until the replacement order is durable.

Provider or database ambiguity leaves the attempt recoverable through its receipt and notes. The API never leaves a known start failure as indefinitely pending.

The response contains only checkout data required by the website: key ID, Razorpay order ID, amount, currency, charge ID, and safe prefill data. It never returns the key secret, webhook secret, provider audit payload, or arbitrary client-controlled notes.

## Webhook and Settlement Processing

### Raw Webhook Route

Mount `POST /api/v1/payments/webhooks/razorpay` before global JSON parsing. Signature validation uses the exact raw request bytes and `RAZORPAY_WEBHOOK_SECRET`. Missing or invalid signatures return `400` without mutating payment state.

Supported events initially include captured/successful payments, failed payments, and processed or failed refunds. Unknown valid events are acknowledged and recorded without changing domain state.

### Idempotent Settlement

The settlement service runs in a database transaction and locks or conditionally updates the charge and attempt records.

For a captured payment it verifies:

- gateway order ID identifies the attempt
- provider payment ID is unique
- provider order ID matches the attempt
- amount equals both the attempt snapshot and charge amount
- currency is `INR`
- provider state is captured, not merely authorized

If the charge is `OPEN`, the service marks the attempt `SUCCESS`, marks the charge `PAID`, stores `paidAttemptId`, and invokes the target adapter. The adapter advances only the exact case/plan obligation represented by that charge and never reopens `COMPLETED`, `CLOSED`, `REJECTED`, or another final state.

If the charge is already `PAID` by the same attempt, processing is a no-op. If another attempt already paid it, the new attempt becomes `DUPLICATE_SUCCESS`, the domain does not advance again, and an administrator alert requests a full refund. A failed, pending, authorized, or late event can never overwrite `SUCCESS`.

For a failed payment, only a non-final attempt becomes `FAILED`. The charge remains `OPEN`; application and certificate payment-required state remains actionable so the user can retry. Authorized and provider-pending states become `AUTHORIZED` or `PENDING` with processing text, never a failure timeline entry.

Timeline, email, and admin notification records are created only for the first meaningful transition. External email/socket delivery happens after commit and cannot roll back settled money state.

## Browser Confirmation and Status

The Razorpay checkout success callback sends `orderId`, `paymentId`, and signature to an authenticated confirmation endpoint. The endpoint validates the checkout signature and then fetches the payment/order from Razorpay or waits for webhook settlement; it does not trust client amount, method, timestamp, or success query parameters.

The website payment-result page receives an opaque charge ID and reads:

`GET /api/v1/payments/charges/:chargeId/status`

This authenticated endpoint verifies ownership and returns only `OPEN`, `PROCESSING`, `PAID`, `FAILED_RETRYABLE`, or `REFUNDED` plus safe display data. It may trigger a throttled reconciliation for that actor's stale attempt. Public reference lookup and PhonePe status lookup are removed.

## Reconciliation

A scheduled reconciliation service runs every five minutes and scans bounded batches of `CREATING`, `PENDING`, and `AUTHORIZED` attempts older than a short threshold. A PostgreSQL-backed lease prevents multiple API instances from processing the same schedule concurrently.

For each attempt:

- fetch the Razorpay order
- fetch or identify its associated payment when attempted/paid
- compare order amount, amount paid, currency, order ID, and payment status
- call the same settlement service used by webhooks
- mark definitively abandoned attempts `EXPIRED` only after provider evidence or configured maximum age
- retain ambiguous attempts for the next run with bounded retry metadata

An ADMIN with MFA may trigger reconciliation for one attempt or one bounded batch. This endpoint is for recovery, not direct status editing. It cannot force success without matching Razorpay evidence.

## Refund Workflow

The endpoint is:

`POST /api/v1/admin/payments/:attemptId/refund`

It requires authentication, `ADMIN`, current MFA, and a bounded reason. `COADMIN` cannot refund money.

The service permits only a full refund of a `SUCCESS` or `DUPLICATE_SUCCESS` attempt that has not already been refunded or requested. It creates a `REQUESTED` record before calling Razorpay. Provider success stores the refund ID and moves the record to `PENDING` until webhook or reconciliation confirms processing. Provider failure records `FAILED` and allows a controlled administrator retry without creating duplicate successful refunds.

Refunding the attempt that paid a charge marks the charge `REFUNDED` after provider confirmation. It does not automatically reverse completed legal work or delete the case; the domain receives an append-only refund event for manual follow-up. Refunding a duplicate success does not change the already-paid charge.

## Authorization and Response Safety

- Customers may list and read only their own charges and attempts.
- `ADMIN` and `COADMIN` with MFA may list payments for operations.
- Only `ADMIN` with MFA may issue refunds or run manual reconciliation.
- Unauthorized access to another customer's payment returns the same `404` as a missing record.
- Customer responses omit provider payloads, internal notes, webhook records, and refund internals.
- Admin detail responses expose only operationally necessary gateway identifiers and sanitized failure information.
- Pagination and search limits are bounded.

## Domain Adapters

The payment core calls one adapter based on the charge target:

- application adapter clears the exact open payment requirement and advances only from the expected payment state
- certificate adapter performs the equivalent guarded transition
- plan adapter creates or extends the `UserPlan` and links the settled payment attempt

Adapters receive a settled charge object and cannot reinterpret amount or category. They use conditional updates so a late callback cannot reopen or regress final domain state. Group 6 can replace the first two adapters with one request adapter without changing charge, attempt, webhook, refund, or reconciliation logic.

## Error Handling and Observability

- Validation errors return `400`; missing authentication returns `401`; role or MFA failures return `403`; ownership-safe misses return `404`; state conflicts return `409`; provider failures return `502` or a retryable processing response.
- Logs use internal charge/attempt IDs and gateway IDs where operationally necessary. They never log secrets, signatures, raw credentials, card data, or full webhook bodies.
- Metrics count attempt starts, start failures, captured payments, amount mismatches, duplicate successes, webhook duplicates, reconciliation recoveries, and refund outcomes.
- Amount mismatch, unknown order, duplicate success, and refund failure produce high-priority administrator alerts.

## API and Client Changes

### API

- remove active PhonePe routes and imports
- mount Razorpay raw webhook before JSON middleware
- replace six duplicated start handlers with charge creation and attempt services
- replace callback helpers with one settlement service and target adapters
- add authenticated charge status, owner-safe payment detail, refund, and reconciliation routes
- enable reconciliation during API startup with graceful shutdown

### Website

- use Razorpay checkout only
- stop posting amount or payment type
- remove PhonePe redirect/status polling and forged query-string success rendering
- use authenticated charge status for application, certificate, and plan payments
- remove the production demo payment page or redirect it to a non-payment page

### Admin

- display charge, attempt, and refund status distinctly
- show duplicate-success and reconciliation warnings
- add ADMIN-only full-refund action with confirmation and reason
- add ADMIN-only reconcile action for stale attempts
- never render raw provider payloads

## Testing Strategy

### Payment Core

- charge amount and category are server-derived and immutable
- only one open attempt is reusable per charge
- gateway start failure marks the attempt failed while leaving the charge open
- exact amount and currency are required for settlement
- pending and authorized events do not create failure entries
- duplicate delivery and concurrent delivery settle once
- failed or late events cannot overwrite success
- a late success cannot regress a final application or certificate
- a second captured attempt becomes `DUPLICATE_SUCCESS` and does not advance the target

### Routes and Security

- payment detail returns `404` to another user and succeeds for owner/admin
- webhook rejects invalid signatures and parses exact raw bytes
- public PhonePe status and unauthenticated Razorpay verification routes are absent
- start/status routes require charge ownership
- refund and reconciliation require primary ADMIN plus MFA
- strict schemas return `400` for malformed requests

### Reconciliation and Refunds

- missed captured webhook is recovered by reconciliation
- failed and abandoned attempts remain retryable correctly
- concurrent reconciliation workers acquire one lease
- full refund is requested once and confirmed idempotently
- duplicate-success refund does not alter the valid paid charge
- provider refund failure remains retryable and auditable

### Clients

- website opens checkout from server-returned order data and reads authenticated status
- website never displays success from query parameters alone
- admin refund requires explicit confirmation and reason
- admin hides refund/reconciliation actions from COADMIN

### Verification

Run focused red-green tests, full API/admin/website suites, TypeScript checks, production builds, Prisma generation, and `git diff --check`. Real Razorpay test-mode checkout, webhook delivery, reconciliation, and refund tests remain deferred until credentials and a reachable callback URL are supplied.

## Rollout and Deferred Integration

1. Apply the payment schema migration before enabling the new API.
2. Configure Razorpay key ID, key secret, and webhook secret through deployment secrets.
3. Configure the test-mode webhook for captured, failed, and refund events.
4. Deploy API and both clients together because old PhonePe endpoints are removed.
5. Run Razorpay test-mode success, failure, retry, duplicate delivery, missed-webhook reconciliation, and full-refund scenarios.
6. Verify the database has one paid charge and one successful attempt per normal transaction.
7. Enable live keys only after test-mode reconciliation reports no mismatches.

## Out of Scope

- partial refunds
- chargebacks and disputes
- invoices, GST documents, and settlement accounting
- plan benefit definition and discount rules
- broad payment-history and revenue-dashboard corrections assigned to Group 5
- generic application/certificate lifecycle unification assigned to Group 6
- commits, pushes, deployment, or live-gateway testing before all groups and local integration checks are complete
