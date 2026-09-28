# Group 2 Signup, Login, and OTP Security Design

**Date:** 2026-09-25
**Status:** Approved in chat; pending written-spec review
**Scope:** BUG-001, BUG-005, BUG-006, BUG-007, BUG-008

## Goal

Provide secure customer signup and login through either Firebase email/password or a self-hosted phone OTP flow while preserving Group 1's Firebase bearer-token contract for every protected API request.

## Decisions

- Customers may sign in with either email/password or phone OTP.
- Firebase remains the identity issuer; PostgreSQL remains authoritative for role and active status.
- The API owns OTP generation, storage, validation, throttling, and audit records.
- SMS delivery is behind an adapter. Group 2 ships a safe development adapter; the self-hosted httpSMS/Android gateway may be connected later without changing OTP logic.
- Admin email/password plus TOTP remains unchanged.
- No existing-user migration is required.

## Authentication Flows

### Email Signup

1. Website creates the Firebase email/password account.
2. Website requests Firebase's email-verification message.
3. Website waits until Firebase reports `emailVerified=true` and refreshes the ID token.
4. Website starts phone verification through the API using the Firebase bearer token.
5. API sends a self-hosted OTP to the normalized phone number.
6. Website verifies the OTP through the API.
7. API creates or updates the PostgreSQL user using the Firebase UID, verified email, verified phone, accepted terms, and submitted profile.
8. The user becomes active only after both email and phone are verified.

### Email Login

1. Website signs in through Firebase email/password.
2. Website rejects access until Firebase reports a verified email.
3. Website sends the Firebase ID token to `/api/v1/auth/session`.
4. API verifies token revocation and loads the current active PostgreSQL user.

Firebase Email Enumeration Protection must be enabled for the project. Client copy remains generic even when Firebase returns a more specific internal error.

### Phone OTP Login

1. Website requests an OTP using a normalized E.164 phone number.
2. API always returns the same accepted response, whether the phone exists or not.
3. API sends an OTP only when policy permits and an active user can authenticate with that phone.
4. Website submits phone, challenge ID, and OTP.
5. API atomically consumes the valid challenge.
6. API creates a Firebase custom token for the PostgreSQL user's Firebase UID.
7. Website calls Firebase `signInWithCustomToken`, receives an ID token, and resumes the standard Group 1 bearer flow.

### Password Reset

Password reset remains Firebase-managed through `sendPasswordResetEmail`. The UI always reports a generic success message to prevent email enumeration.

## API Surface

Public endpoints:

- `POST /api/v1/auth/otp/login/request`
- `POST /api/v1/auth/otp/login/verify`

Firebase-authenticated signup endpoints:

- `POST /api/v1/auth/signup/phone/request`
- `POST /api/v1/auth/signup/phone/verify`
- `POST /api/v1/auth/signup/complete`

Existing endpoints retained:

- `GET /api/v1/auth/session`
- Admin MFA endpoints from Group 1

All request endpoints return `202` with generic copy. Verification errors use generic invalid-or-expired responses and never disclose whether an account exists.

## OTP Model

Add `OtpChallenge` with:

- UUID primary key exposed as the challenge ID.
- Purpose: `SIGNUP_PHONE` or `LOGIN_PHONE`.
- Normalized phone hash for lookup and throttling.
- Encrypted normalized phone only when delivery needs it.
- HMAC-SHA-256 OTP digest using a dedicated pepper.
- Expiration timestamp.
- Maximum-attempt count and current attempts.
- Resend availability timestamp.
- Consumed timestamp.
- Request IP hash and creation timestamp.

Plaintext OTP values are never stored or logged.

## OTP Policy

- Six numeric digits generated with cryptographically secure randomness.
- Five-minute expiration.
- Five verification attempts per challenge.
- Sixty-second resend cooldown.
- A challenge is single-use and consumed atomically.
- Creating a replacement challenge invalidates earlier active challenges for the same phone and purpose.
- Production fails closed if the SMS provider or OTP secrets are missing.

## Rate Limiting

Use a shared `RateLimiter` abstraction with PostgreSQL-backed counters so limits work across multiple API instances.

- OTP request: five per phone per hour and ten per IP per hour.
- OTP verify: five attempts per challenge and twenty per IP per hour.
- Signup completion: five per Firebase UID per hour and ten per IP per hour.
- Session/login failures: twenty per IP per fifteen minutes.

Every rejection uses generic client text. Server logs include only request IDs, hashed identifiers, purpose, and outcome.

## SMS Provider Boundary

Define:

```ts
interface SmsProvider {
  sendOtp(input: { phone: string; code: string; expiresInSeconds: number }): Promise<void>;
}
```

Initial providers:

- `DevelopmentSmsProvider`: available only outside production; captures delivery through an injected test sink and never logs the code through the application logger.
- `HttpSmsProvider`: configuration contract reserved for the self-hosted gateway and selected with `SMS_PROVIDER=httpsms` when gateway details are available.

The OTP service depends only on `SmsProvider`, so transport integration does not alter controllers, persistence, or clients.

## Firebase and PostgreSQL Linking

- Email signup uses the Firebase UID from the verified bearer token.
- Phone login never invents a second UID. It loads the PostgreSQL user by normalized phone and issues a Firebase custom token for that user's stored UID.
- Signup completion is transactional and rejects UID, email, or phone collisions with generic conflict text.
- `User.emailVerified` is copied from a freshly verified Firebase token, not client input.
- Add `User.phoneVerifiedAt` and set it only after successful OTP consumption.
- An active customer requires a non-null Firebase UID, verified email, and verified phone.

## Website Experience

The login page provides two modes:

- Email/password with Firebase email verification and generic password-reset copy.
- Phone OTP with request, cooldown timer, six-digit input, retry handling, and Firebase custom-token exchange.

Signup is a staged flow:

1. Name, email, password, phone, and terms.
2. Verify email.
3. Verify phone.
4. Complete profile and enter the dashboard.

Refreshing the browser reconstructs progress from Firebase state and API challenge state; passwords and OTP values are never persisted locally.

## Error Handling

- Invalid, expired, consumed, or over-attempt OTPs share one public error.
- Existing email/phone and nonexistent email/phone produce indistinguishable public request responses.
- SMS transport failures are logged without phone or OTP and return the same accepted request response.
- Login verification atomically consumes the challenge before issuing a Firebase custom token. If token issuance fails, the client receives a generic error and must request a new OTP; this avoids issuing multiple tokens from one challenge.
- Disabled users cannot receive a usable login token.

## Configuration

API environment additions:

- `OTP_PEPPER` with at least 32 random bytes.
- `OTP_PHONE_ENCRYPTION_KEY` with at least 32 random bytes.
- `SMS_PROVIDER=development|httpsms`.
- Future httpSMS URL/token/device values remain unset until the gateway is deployed.

No client-side SMS or OTP secret is introduced.

## Testing

API tests cover:

- OTP hashing, expiry, cooldown, attempts, replacement, and atomic consumption.
- Enumeration-resistant responses.
- Per-IP and per-identifier rate limits.
- Firebase email-verification enforcement.
- Signup collision and activation rules.
- Phone login custom-token issuance and disabled-user rejection.
- Production fail-closed provider configuration.

Website tests cover:

- Email signup stages and verified-email refresh.
- Phone OTP request, cooldown, verification, and resend.
- Phone-login custom-token exchange.
- Generic error copy and refresh recovery.

Final verification requires tests, typechecks, and production builds for API and website, plus an unchanged passing admin build.

## Out of Scope

- Deploying or operating the self-hosted httpSMS/Android gateway.
- Admin authentication changes.
- Payment, mail/file authorization, and deployment topology work from later groups.
