# Group 2 Signup, Login, and OTP Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure customer signup and login through verified Firebase email/password or self-hosted phone OTP while preserving Firebase bearer authentication.

**Architecture:** PostgreSQL stores hashed, expiring, single-use OTP challenges and distributed rate-limit counters. The API owns OTP policy and Firebase custom-token issuance; an injected SMS provider isolates delivery. The website uses Firebase for email/password and exchanges verified phone challenges for Firebase custom tokens.

**Tech Stack:** Express 5, TypeScript 5.8, Prisma 6/PostgreSQL, Firebase Admin 13, Zod 4, Vitest, Next.js 15, Firebase Web 12, Zustand 5.

**Spec:** `docs/superpowers/specs/2026-09-25-group-2-signup-login-otp-design.md`

## Global Constraints

- Firebase issues every customer access token; no API session JWT or authentication cookie may be introduced.
- PostgreSQL remains authoritative for role and active status.
- OTP plaintext is never stored or logged.
- Public responses must not reveal whether an email or phone exists.
- OTPs are six digits, expire after five minutes, allow five attempts, enforce a sixty-second resend cooldown, and are single-use.
- Production fails closed when OTP secrets or the SMS provider are missing.
- Admin email/password plus TOTP behavior from Group 1 must remain unchanged.

---

### Task 1: OTP Persistence and Cryptography

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260925160000_group2_customer_auth/migration.sql`
- Create: `server/src/services/otpChallenge.ts`
- Test: `server/src/services/otpChallenge.test.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `createOtpChallenge(input): Promise<{ challengeId: string; code: string; retryAfterSeconds: number }>`.
- Produces: `consumeOtpChallenge(input): Promise<{ valid: boolean; reason: "accepted" | "invalid" }>`.
- Consumes: `OTP_PEPPER` and `OTP_PHONE_ENCRYPTION_KEY`, each at least 32 characters.

- [ ] **Step 1: Write failing OTP lifecycle tests**

Cover secure six-digit generation, HMAC digest storage, encrypted phone storage, five-minute expiry, five-attempt exhaustion, sixty-second cooldown, replacement invalidation, and atomic single consumption.

- [ ] **Step 2: Run focused tests and verify red**

Run: `npm test -- src/services/otpChallenge.test.ts`

Expected: FAIL because `otpChallenge.ts` and Prisma models do not exist.

- [ ] **Step 3: Add Prisma models and migration**

Add `OtpPurpose` (`SIGNUP_PHONE`, `LOGIN_PHONE`) and `OtpChallenge` fields: UUID id, purpose, phoneHash, encryptedPhone, codeDigest, expiresAt, resendAt, attempts, maxAttempts default 5, consumedAt, invalidatedAt, requestIpHash, createdAt, updatedAt. Add indexes on `(phoneHash, purpose, createdAt)`, `(requestIpHash, createdAt)`, and `expiresAt`. Add nullable `User.phoneVerifiedAt`.

- [ ] **Step 4: Implement minimal OTP service**

Use `randomInt(0, 1_000_000).toString().padStart(6, "0")`, HMAC-SHA-256 with `OTP_PEPPER`, AES-256-GCM for phone encryption, constant-time digest comparison, and a Prisma transaction for attempt increment plus conditional consumption.

- [ ] **Step 5: Generate Prisma and run green tests**

Run: `npx prisma generate && npm test -- src/services/otpChallenge.test.ts && npm run typecheck`

Expected: PASS.

---

### Task 2: PostgreSQL Rate Limiter

**Files:**
- Modify: `server/prisma/schema.prisma`
- Modify: `server/prisma/migrations/20260925160000_group2_customer_auth/migration.sql`
- Create: `server/src/services/rateLimiter.ts`
- Test: `server/src/services/rateLimiter.test.ts`

**Interfaces:**
- Produces: `consumeRateLimit(input: { scope: string; key: string; limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>`.

- [ ] **Step 1: Write failing distributed-counter tests**

Cover first request, exact limit, over-limit retry time, expired-window reset, independent scopes, and concurrent increments.

- [ ] **Step 2: Run test and verify red**

Run: `npm test -- src/services/rateLimiter.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Add `RateLimitBucket` and service**

Use unique `(scope, key, windowStart)`, hashed email/phone/IP keys, database upsert increments, and transaction retry on unique conflicts. Never persist raw identifiers.

- [ ] **Step 4: Run green tests**

Run: `npm test -- src/services/rateLimiter.test.ts && npm run typecheck`

Expected: PASS.

---

### Task 3: SMS Provider Boundary

**Files:**
- Create: `server/src/services/sms/types.ts`
- Create: `server/src/services/sms/developmentSmsProvider.ts`
- Create: `server/src/services/sms/httpSmsProvider.ts`
- Create: `server/src/services/sms/index.ts`
- Test: `server/src/services/sms/index.test.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `SmsProvider.sendOtp({ phone, code, expiresInSeconds }): Promise<void>`.
- Produces: `createSmsProvider(env): SmsProvider`.

- [ ] **Step 1: Write failing provider-selection tests**

Verify development selection outside production, production rejection of development mode, missing httpSMS configuration rejection, payload mapping, and secret-free errors.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- src/services/sms/index.test.ts`

- [ ] **Step 3: Implement providers**

The development provider accepts an injected test sink and never logs OTPs. `HttpSmsProvider` implements the reserved HTTP contract using `HTTPSMS_BASE_URL`, `HTTPSMS_API_TOKEN`, and `HTTPSMS_DEVICE_ID`; construction fails when values are missing.

- [ ] **Step 4: Run green tests**

Run: `npm test -- src/services/sms/index.test.ts && npm run typecheck`

Expected: PASS without making a network call.

---

### Task 4: Verified Email and Phone Signup

**Files:**
- Create: `server/src/controller/customerSignup.controller.ts`
- Create: `server/src/zodSchema/customerAuth.schema.ts`
- Modify: `server/src/routes/auth.route.ts`
- Modify: `server/src/config/firebase.ts`
- Test: `server/src/routes/customerSignup.route.test.ts`

**Interfaces:**
- Adds: `POST /signup/phone/request`, `POST /signup/phone/verify`, `POST /signup/complete`.
- Produces generic `202 { success: true, message: "If eligible, verification will continue." }` request responses.

- [ ] **Step 1: Write failing signup route tests**

Cover missing Firebase bearer token, unverified Firebase email, generic request responses, phone normalization, rate-limit rejection, invalid OTP, UID/email/phone collision, terms requirement, and successful active USER creation.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- src/routes/customerSignup.route.test.ts`

- [ ] **Step 3: Expose verified Firebase claims**

Extend request identity with `emailVerified` from a freshly verified ID token. Signup middleware accepts a Firebase identity before a PostgreSQL user exists; normal `authenticate` continues requiring an active database user.

- [ ] **Step 4: Implement signup controllers and validation**

Normalize Indian numbers to E.164, apply UID/IP/phone limits, send through `SmsProvider`, mark the verified challenge, and transactionally create the PostgreSQL user with Firebase UID, verified email, verified phone, terms timestamp, `phoneVerifiedAt`, `emailVerified=true`, `isActive=true`, and `role=USER`.

- [ ] **Step 5: Run green tests**

Run: `npm test -- src/routes/customerSignup.route.test.ts && npm run typecheck`

Expected: PASS.

---

### Task 5: Phone OTP Login and Firebase Custom Token

**Files:**
- Create: `server/src/controller/customerLogin.controller.ts`
- Modify: `server/src/routes/auth.route.ts`
- Modify: `server/src/config/firebase.ts`
- Test: `server/src/routes/customerLogin.route.test.ts`

**Interfaces:**
- Adds: `POST /otp/login/request` and `POST /otp/login/verify`.
- Produces: `{ success: true, customToken: string }` only after accepted OTP consumption for an active user.

- [ ] **Step 1: Write failing phone-login tests**

Cover enumeration-resistant request responses, inactive/nonexistent users receiving no usable challenge, cooldown and rate limits, invalid/expired/reused OTP, custom token bound to stored UID, and disabled-user rejection.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- src/routes/customerLogin.route.test.ts`

- [ ] **Step 3: Implement request and verification**

Request creates and sends only for eligible active users but always returns the generic accepted response. Verification consumes exactly once, reloads active user state, then calls `firebaseAuth.createCustomToken(user.uid, { loginMethod: "phone_otp" })`.

- [ ] **Step 4: Run green tests**

Run: `npm test -- src/routes/customerLogin.route.test.ts && npm run typecheck`

Expected: PASS.

---

### Task 6: Email Verification and Enumeration Regression

**Files:**
- Modify: `server/src/middleware/authMiddleware.ts`
- Modify: `server/src/controller/session.controller.ts`
- Modify: `server/src/middleware/authMiddleware.test.ts`
- Create: `server/src/routes/customerAuth.regression.test.ts`

**Interfaces:**
- Customer sessions require Firebase `email_verified=true` and active PostgreSQL identity.
- Admin Firebase login remains valid under the Group 1 ADMIN/COADMIN plus TOTP policy.

- [ ] **Step 1: Write failing regressions**

Verify unverified customer email rejection, verified customer access, unchanged admin behavior, identical unknown/existing identifier request responses, and absence of legacy login/register/password-reset API routes.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- src/middleware/authMiddleware.test.ts src/routes/customerAuth.regression.test.ts`

- [ ] **Step 3: Implement claim enforcement and generic errors**

Reject unverified USER sessions with `403 { error: "Verification required" }`; never expose Firebase error codes or account existence in public route responses or logs.

- [ ] **Step 4: Run API authentication suite**

Run: `npm test -- src/middleware/authMiddleware.test.ts src/routes/customerAuth.regression.test.ts src/routes/auth.route.test.ts`

Expected: PASS.

---

### Task 7: Website Auth Client and Store

**Files:**
- Modify: `../website/package.json`
- Create: `../website/vitest.config.ts`
- Create: `../website/config/customerAuthApi.ts`
- Modify: `../website/store/useAuthStore.ts`
- Test: `../website/store/useAuthStore.test.ts`

**Interfaces:**
- Produces store methods: `signupWithEmail`, `refreshEmailVerification`, `requestSignupOtp`, `verifySignupOtp`, `completeSignup`, `requestLoginOtp`, `loginWithPhoneOtp`, `loginWithEmail`, `sendPasswordReset`, and `logout`.

- [ ] **Step 1: Install website test tooling and write failing store tests**

Add Vitest and jsdom. Mock Firebase boundaries and verify email signup, email verification refresh, API challenge calls, custom-token exchange, generic errors, and no password/OTP persistence.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- store/useAuthStore.test.ts`

- [ ] **Step 3: Implement API client and auth store**

Use `createUserWithEmailAndPassword`, `sendEmailVerification`, `reload`, `signInWithEmailAndPassword`, `signInWithCustomToken`, and `sendPasswordResetEmail`. Persist no authentication booleans, passwords, OTPs, or challenge secrets.

- [ ] **Step 4: Run green tests and typecheck**

Run: `npm test -- store/useAuthStore.test.ts && npx tsc --noEmit`

Expected: PASS.

---

### Task 8: Website Signup and Dual Login UI

**Files:**
- Modify: `../website/app/login/page.tsx`
- Create: `../website/app/signup/page.tsx`
- Create: `../website/components/auth/OtpInput.tsx`
- Create: `../website/components/auth/VerificationStatus.tsx`
- Test: `../website/components/auth/authFlows.test.tsx`

**Interfaces:**
- Login exposes Email and Phone OTP modes.
- Signup exposes Account, Verify Email, Verify Phone, and Complete stages.

- [ ] **Step 1: Write failing component-flow tests**

Cover mode switching, six-digit filtering, resend countdown, disabled resend, generic errors, verified-email refresh, signup stage progression, and successful redirects.

- [ ] **Step 2: Run tests and verify red**

Run: `npm test -- components/auth/authFlows.test.tsx`

- [ ] **Step 3: Implement accessible staged forms**

Use labeled fields, `aria-live` status, no OTP/password local persistence, a sixty-second countdown based on API retry data, and generic public messages. Keep phone OTP unavailable only when the API reports provider unavailability.

- [ ] **Step 4: Run UI tests and production build**

Run: `npm test -- components/auth/authFlows.test.tsx && npx tsc --noEmit && .\\node_modules\\.bin\\next.cmd build`

Expected: PASS.

---

### Task 9: Group 2 Regression and Production Verification

**Files:**
- Modify: `server/.env.example`
- Modify: `../website/.env.example` only if a public Firebase key name changes
- Create: `server/docs/customer-auth-operations.md`

**Interfaces:**
- Documents Firebase Email Enumeration Protection, required API secrets, development SMS behavior, future httpSMS variables, database migration, and smoke-test commands.

- [ ] **Step 1: Document operator setup**

Document generating `OTP_PEPPER` and `OTP_PHONE_ENCRYPTION_KEY`, enabling Firebase email/password plus Email Enumeration Protection, applying Prisma migrations, and confirming `SMS_PROVIDER=development` is rejected in production.

- [ ] **Step 2: Run full API verification**

Run: `npx prisma generate && npm test && npm run typecheck && npm run build`

Expected: all tests and build pass.

- [ ] **Step 3: Run full website verification**

Run: `npm test && npx tsc --noEmit && .\\node_modules\\.bin\\next.cmd build`

Expected: all tests and build pass.

- [ ] **Step 4: Confirm admin regression build**

Run in `../admin`: `npm run build`

Expected: PASS with no authentication changes.

- [ ] **Step 5: Run security scans**

Search tracked source for OTP logging, plaintext OTP persistence, legacy login/register routes, authentication cookies, committed secrets, and Firebase service-account material. Expected: no active matches; test fixtures may contain fake values only.

- [ ] **Step 6: Review final diffs**

Run `git diff --check` in API, website, and admin. Confirm Group 1 behavior remains green and no generated sitemap/build files are included.
