# Group 3 Access-Control Operations

## Required configuration

- Configure PostgreSQL with `DATABASE_URL`, then apply Prisma migrations before starting the API.
- Configure Firebase Admin with `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Set `ADMIN_APP_URL` to the admin application's public base URL. Firebase co-admin setup links return there.
- Configure Cloudinary with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- Configure SMTP/IMAP with the `MAIL_*` and `IMAP_*` variables.
- Keep all provider credentials in deployment secrets. Do not commit populated environment files.

## Enforced limits

- Uploads require authentication and accept at most four files per request.
- Each file is limited to 10 MB and must be JPEG, PNG, WebP, or PDF with a matching extension.
- Temporary uploads are deleted by internal `assetId`; provider public IDs are never accepted as authorization input.
- Operational mail requires an ADMIN or COADMIN session with current MFA proof.
- Mail sends allow at most ten recipients and are limited to 20 requests per administrator and IP per hour.
- Co-admin management is restricted to the primary `ADMIN` role and requires current MFA proof.

## Migration and rollout order

1. Back up PostgreSQL.
2. Apply `20260926110000_group3_access_control`.
3. Deploy the API.
4. Deploy admin and website clients that submit attachment `assetId` values.
5. Verify health and authentication before enabling operational access.

## Deferred real-service checks

Complete these checks after production-like secrets are supplied and before commit, push, or deployment:

- Create, resend, activate, and deactivate a co-admin through Firebase and the admin UI.
- Confirm the Firebase password-setup link returns to `ADMIN_APP_URL` and never appears in API responses or logs.
- Upload and delete each allowed file type in Cloudinary; confirm cross-user deletion and attached-asset deletion are blocked.
- Send and receive operational mail through the configured SMTP/IMAP account; confirm SMTP errors return a failure response.
- Apply the migration to a disposable PostgreSQL database and exercise document, application, and certificate attachment claims.
- Complete browser-level MFA enrollment, recovery-code verification, co-admin management, and customer attachment flows.
