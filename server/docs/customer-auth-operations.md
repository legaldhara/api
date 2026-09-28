# Customer Authentication Operations

## Required services

- Firebase Authentication with the Email/Password provider enabled.
- Firebase Email Enumeration Protection enabled in Identity Platform settings.
- PostgreSQL with the Group 1 and Group 2 Prisma migrations applied.
- An SMS provider. Development capture is allowed only when `NODE_ENV` is not `production`.

## Secrets

Generate independent random values for OTP hashing and phone encryption. Each value must contain at least 32 characters and must be stored only in the deployment secret manager.

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Assign the first output to `OTP_PEPPER` and the second to `OTP_PHONE_ENCRYPTION_KEY`. Do not reuse Firebase, database, TOTP, or payment secrets.

The API also requires `FIREBASE_SERVICE_ACCOUNT_JSON`, `TOTP_ENCRYPTION_KEY`, and `ADMIN_MFA_SIGNING_SECRET` from Group 1.

## SMS configuration

For local development and automated tests:

```env
NODE_ENV=development
SMS_PROVIDER=development
```

The development provider does not log OTPs. Tests or local tooling must inject a delivery sink when the plaintext code needs to be inspected. Startup or provider construction rejects development mode when `NODE_ENV=production`.

For httpSMS:

```env
SMS_PROVIDER=httpsms
HTTPSMS_BASE_URL=https://api.httpsms.com/v1
HTTPSMS_API_TOKEN=<secret API key>
HTTPSMS_DEVICE_ID=<sender phone in E.164 format>
```

`HTTPSMS_DEVICE_ID` maps to the httpSMS `from` phone number. The provider sends the API key in `x-api-key` and posts to `/messages/send`. See the [official httpSMS API documentation](https://docs.httpsms.com/).

## Database migration

Generate the client and apply committed migrations during deployment:

```powershell
npx prisma generate
npx prisma migrate deploy
```

The Group 2 migration adds encrypted, expiring OTP challenges, UID-bound signup verification state, phone verification timestamps, and PostgreSQL-backed rate-limit buckets.

## Firebase checks

1. Enable Email/Password authentication.
2. Configure the authorized production domains.
3. Enable Email Enumeration Protection.
4. Confirm verification email templates use the production website domain.
5. Confirm the API service account can verify ID tokens and create custom tokens.

Customer database sessions require `email_verified=true`. Phone login succeeds by exchanging a consumed self-hosted OTP challenge for a Firebase custom token; the website then resumes the standard Firebase bearer-token flow.

## Smoke tests

```powershell
npm test
npm run typecheck
npm run build
```

Verify these flows against staging:

1. Email signup cannot continue before the Firebase email is verified.
2. Phone signup OTP expires after five minutes, rejects the sixth attempt, and cannot be reused.
3. Phone login request responses have the same status and shape for existing and unknown numbers.
4. Phone OTP login returns a Firebase-backed session only for an active linked user.
5. Password reset always displays generic public copy.
6. Admin email/password plus TOTP remains unchanged.

Never log OTP codes, Firebase ID/custom tokens, service-account JSON, phone encryption keys, or API keys.
