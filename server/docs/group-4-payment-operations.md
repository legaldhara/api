# Group 4 Payment Operations

Production DNS, Caddy, secrets, health checks, logs, backup, rollback, and cutover procedures are defined in `../../docs/deployment.md`.

## Configuration

- Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in the API secret store.
- Use separate Razorpay test and live credentials. Never place either secret in the website or admin build.
- The website receives only the public key ID returned with an authenticated payment attempt.

## Webhook

- Configure Razorpay to send events to `POST /api/v1/payments/webhooks/razorpay`.
- Subscribe to captured and failed payment events. Refund processed and failed events must also be enabled before refund testing.
- The API verifies the signature against the exact raw request body and deduplicates by Razorpay event ID or payload digest.

## Reconciliation

- The API scans at most 50 stale attempts every five minutes.
- A PostgreSQL lease prevents overlapping runs across API instances.
- ADMIN users with current MFA can reconcile one attempt from the admin payment screen.

## Refunds

- Only primary `ADMIN` users with current MFA can request refunds.
- Refunds are full only. A reason is required and one refund record is allowed per attempt.
- A paid charge becomes `REFUNDED` only after Razorpay confirms the refund of its paying attempt.

## Migration Order

1. Back up the database.
2. Apply Prisma migrations before starting the new API build.
3. Start the API and verify the health endpoint.
4. Configure the raw webhook URL and subscribed events in Razorpay test mode.
5. Deploy the website and admin only after the API is healthy.

## Deferred Credential Tests

Before commit, push, or deployment, run Razorpay test-mode checkout, browser confirmation, raw webhook delivery, duplicate webhook delivery, missed-webhook reconciliation, duplicate capture recovery, and full-refund confirmation using a reachable callback URL.
