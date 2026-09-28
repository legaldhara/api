# Group 1 Authentication and Session Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LegalDhara's custom JWT/RSA/cookie authentication with Firebase bearer authentication, current PostgreSQL authorization, mandatory admin TOTP, authenticated sockets, and regression coverage for BUG-002, 003, 004, and 009-015.

**Architecture:** Firebase proves identity with short-lived ID tokens sent in the Authorization header. The API verifies revocation and loads role/status from PostgreSQL on every request. Admin routes and sockets additionally require a short-lived HttpOnly TOTP proof cookie.

**Tech Stack:** Node.js 20, Express 5, TypeScript 5.8, Firebase Admin 13, Prisma 6/PostgreSQL, Socket.IO 4, React/Next.js 15, React/Vite 6, Vitest, Supertest, otplib.

**Spec:** `docs/superpowers/specs/2026-09-23-group-1-auth-security-design.md`

## Global Constraints

- Do not preserve custom access JWTs, refresh JWTs, RSA session encryption, or authentication cookies.
- PostgreSQL is authoritative for role and active status on every protected request.
- Admin HTTP and Socket.IO access requires Firebase, an active ADMIN/COADMIN role, and TOTP proof.
- Customer APIs use Firebase bearer tokens without cookies.
- No existing-user migration is required.
- Never commit Firebase service accounts, TOTP secrets, recovery codes, or local `.env` files.
- Use generic client authentication errors and detailed secret-free server logs.

---

### Task 1: API Test Harness and App Boundary

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/index.ts`
- Create: `server/src/app.ts`
- Create: `server/src/server.ts`
- Create: `server/vitest.config.ts`
- Create: `server/src/test/setup.ts`
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(): Express` in `src/app.ts`.
- Produces: `startServer(): Promise<http.Server>` in `src/server.ts`.
- Consumes: existing routers and middleware without changing route behavior yet.

- [ ] **Step 1: Add test dependencies and scripts**

Add `vitest`, `supertest`, `@types/supertest`, and `socket.io-client` to dev dependencies. Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit",
"prebuild": "prisma generate"
```

- [ ] **Step 2: Write the failing app-factory test**

```ts
import request from "supertest";
import { createApp } from "./app";

it("serves the health endpoint without starting the production listener", async () => {
  const response = await request(createApp()).get("/api/appCheck");
  expect(response.status).toBe(200);
  expect(response.body.status).toBe("healthy");
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npm test -- src/app.test.ts`

Expected: FAIL because `src/app.ts` does not exist.

- [ ] **Step 4: Extract app creation from server startup**

Move middleware, routes, and health endpoints into `createApp()`. Keep `server.listen`, signal handlers, and Socket.IO initialization in `startServer()`. Make `src/index.ts` call only `startServer()`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- src/app.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/index.ts server/src/app.ts server/src/server.ts server/vitest.config.ts server/src/test/setup.ts server/src/app.test.ts
git commit -m "test(api): add isolated application test harness"
```

---

### Task 2: Firebase Identity and Database Authorization

**Files:**
- Modify: `server/src/config/firebase.ts`
- Replace: `server/src/middleware/authMiddleware.ts`
- Modify: `server/src/middleware/authorize.ts`
- Modify: `server/src/types/custom.d.ts`
- Create: `server/src/middleware/authMiddleware.test.ts`
- Modify: `server/src/routes/auth.route.ts`
- Create: `server/src/controller/session.controller.ts`

**Interfaces:**
- Produces: `authenticate(req, res, next)` using `Authorization: Bearer`.
- Produces: `AuthRequest.auth` with `{ id, uid, role, isActive, email, phone, emailVerified }`.
- Produces: `GET /api/v1/auth/session`.
- Consumes: `firebaseAdmin.auth().verifyIdToken(token, true)` and `prisma.user.findUnique({ where: { uid } })`.

- [ ] **Step 1: Write failing middleware tests**

Cover missing header, malformed scheme, invalid token, revoked token, missing DB user, inactive user, and a valid active user. The success assertion must verify role comes from the mocked database, not token claims.

```ts
expect(prisma.user.findUnique).toHaveBeenCalledWith({
  where: { uid: "firebase-uid" },
  select: expect.objectContaining({ role: true, isActive: true }),
});
expect(request.auth?.role).toBe("USER");
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/middleware/authMiddleware.test.ts`

Expected: FAIL because middleware still reads the `idToken` cookie.

- [ ] **Step 3: Make Firebase initialization fail fast**

Initialize Firebase once from `FIREBASE_CRED_PATH` or Application Default Credentials. Throw during startup when credentials/project configuration is absent instead of logging and continuing.

- [ ] **Step 4: Implement bearer authentication**

Parse exactly one Bearer token, call `verifyIdToken(token, true)`, load the user by UID, reject missing/inactive users, and attach only database-derived authorization fields.

- [ ] **Step 5: Implement current-role authorization and session response**

Keep `authorize(...roles)` but consume only the new context. `GET /auth/session` returns public profile fields and current role; it never returns tokens or secrets.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- src/middleware/authMiddleware.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/config/firebase.ts server/src/middleware server/src/types/custom.d.ts server/src/routes/auth.route.ts server/src/controller/session.controller.ts
git commit -m "feat(api): authenticate requests with Firebase tokens"
```

---

### Task 3: Remove Legacy Authentication Attack Paths

**Files:**
- Delete: `server/src/config/encryption.ts`
- Replace: `server/src/controller/auth.controller.ts`
- Modify: `server/src/routes/auth.route.ts`
- Modify: `server/src/zodSchema/user.schema.ts`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_remove_legacy_auth/migration.sql`
- Test: `server/src/routes/auth.route.test.ts`

**Interfaces:**
- Removes: `/validate`, `/admin/login`, `/user/login-by-phone`, `/user/login-by-email`, `/refresh`, `/user/register`, `/user/update-password`, `/logout`, `/coadmin/register`.
- Removes: password and custom refresh-session behavior.
- Preserves: `/session` and the later MFA routes.

- [ ] **Step 1: Write failing route-removal tests**

For every removed route, send the original HTTP method and assert 404. Include the production test numbers and public password-reset payload to prove neither path executes.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/routes/auth.route.test.ts`

Expected: FAIL because legacy routes still exist.

- [ ] **Step 3: Remove legacy controllers, routes, schemas, and dependencies**

Delete custom JWT/RSA/hash flows and remove `jsonwebtoken` and `bcryptjs` unless still required by non-auth code. Remove `User.password`; make `User.uid` required and unique. Do not delete the `Token` model because FCM still uses it.

- [ ] **Step 4: Generate the migration and Prisma client**

Run: `npx prisma migrate dev --name remove_legacy_auth --create-only` then `npx prisma generate`.

Expected: migration drops `User.password`, makes `User.uid` non-null, and does not alter FCM token storage.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- src/routes/auth.route.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src server/prisma server/package.json server/package-lock.json
git commit -m "fix(api): remove insecure legacy authentication"
```

---

### Task 4: Admin TOTP Enrollment and Verification

**Files:**
- Modify: `server/package.json`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_add_admin_security/migration.sql`
- Create: `server/src/services/adminMfa.ts`
- Create: `server/src/middleware/requireAdminMfa.ts`
- Create: `server/src/controller/adminMfa.controller.ts`
- Create: `server/src/scripts/bootstrapAdmin.ts`
- Modify: `server/src/routes/auth.route.ts`
- Create: `server/src/services/adminMfa.test.ts`
- Create: `server/src/middleware/requireAdminMfa.test.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `createEnrollment(userId)`, `confirmEnrollment(userId, code)`, `verifyMfa(userId, code)`, `consumeRecoveryCode(userId, code)`.
- Produces: `requireAdminMfa` middleware.
- Produces: `npm run admin:bootstrap -- --uid <firebase-uid> --email <email>` for the first ADMIN record.
- Produces cookie: `__Host-admin_mfa`, HttpOnly, Secure, SameSite=Strict, Path=/, eight-hour expiry.
- Consumes: `TOTP_ENCRYPTION_KEY`, `ADMIN_MFA_SIGNING_SECRET`.

- [ ] **Step 1: Add `otplib` and write failing service tests**

Test encrypted secret storage, valid confirmation, invalid code, same-time-step replay rejection, recovery code one-time use, and non-admin rejection.

- [ ] **Step 2: Add the `AdminSecurity` model**

```prisma
model AdminSecurity {
  id                    String   @id @default(uuid()) @db.Uuid
  userId                String   @unique @db.Uuid
  encryptedTotpSecret   String
  enabledAt             DateTime?
  recoveryCodeHashes    String[]
  lastAcceptedTimeStep  BigInt?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Implement encryption and TOTP service**

Use AES-256-GCM with a random IV for TOTP secrets. Generate ten high-entropy recovery codes and store SHA-256 hashes. Return plaintext recovery codes only once after enrollment confirmation.

- [ ] **Step 4: Write failing MFA-cookie middleware tests**

Cover absent, expired, forged, wrong-UID, wrong-purpose, and valid proofs.

- [ ] **Step 5: Implement MFA routes and middleware**

Enrollment and confirmation require Firebase plus ADMIN/COADMIN. Verification is rate-limited per UID and IP. Protected admin routers use `authenticate`, `authorize`, then `requireAdminMfa`.

- [ ] **Step 6: Add the explicit first-admin bootstrap command**

The script must require both `--uid` and `--email`, upsert exactly one active `ADMIN` user keyed by Firebase UID, never create credentials, and print no secrets. Add the `admin:bootstrap` package script and document that it is an operator-only command.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npm test -- src/services/adminMfa.test.ts src/middleware/requireAdminMfa.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/package-lock.json server/prisma server/src/services/adminMfa.ts server/src/services/adminMfa.test.ts server/src/middleware/requireAdminMfa.ts server/src/middleware/requireAdminMfa.test.ts server/src/controller/adminMfa.controller.ts server/src/scripts/bootstrapAdmin.ts server/src/routes/auth.route.ts server/.env.example
git commit -m "feat(api): require TOTP for administrative access"
```

---

### Task 5: CORS, CSRF, Proxy, and Route Security

**Files:**
- Modify: `server/src/config/cors.ts`
- Modify: `server/src/app.ts`
- Modify: every server route file containing administrative routes
- Create: `server/src/config/cors.test.ts`
- Create: `server/src/routes/authorization.test.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `parseAllowedOrigins(value: string): string[]`.
- Produces: strict middleware order `authenticate -> authorize -> requireAdminMfa` for admin routes.

- [ ] **Step 1: Write failing CORS tests**

Test exact allowed origins, rejected unknown origins, production rejection of localhost, Authorization allowance, and admin credential support without wildcard origins.

- [ ] **Step 2: Write route authorization matrix tests**

Enumerate every route and assert anonymous, USER, COADMIN, and ADMIN outcomes. Assert administrative routes reject missing MFA.

- [ ] **Step 3: Implement environment-driven CORS and proxy trust**

Parse `CORS_ORIGINS`; reject malformed URLs and wildcard values in production. Set `app.set("trust proxy", 1)`. Remove global URL-encoded parsing. Keep JSON limits unchanged until Group 3 upload work.

- [ ] **Step 4: Apply middleware consistently**

Move administrative routes behind all three checks. Keep customer routes behind Firebase and explicit role checks where route semantics are customer-only.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/config/cors.test.ts src/routes/authorization.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/config/cors.ts server/src/config/cors.test.ts server/src/app.ts server/src/routes server/src/routes/authorization.test.ts server/.env.example
git commit -m "fix(api): enforce origin and route security"
```

---

### Task 6: Authenticated Admin Socket.IO

**Files:**
- Create: `server/src/socket/createSocketServer.ts`
- Create: `server/src/socket/socketAuth.ts`
- Modify: `server/src/server.ts`
- Test: `server/src/socket/socketAuth.test.ts`

**Interfaces:**
- Produces: `createSocketServer(httpServer): Server`.
- Consumes: handshake `auth.token`, PostgreSQL user lookup, and `__Host-admin_mfa` cookie.
- Removes: `join-admins` event.

- [ ] **Step 1: Write failing socket authorization tests**

Test anonymous, invalid Firebase, USER, inactive admin, missing MFA, mismatched MFA, and active admin connections. Assert only the final case joins `ADMINS`.

- [ ] **Step 2: Implement socket authentication middleware**

Verify the handshake Firebase token with revocation checking, load database role/status, parse and verify the MFA cookie, then attach the server-derived identity to `socket.data`.

- [ ] **Step 3: Join the room server-side**

Automatically join `ADMINS` only after successful middleware. Do not register a client-controlled room-join event.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- src/socket/socketAuth.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/socket server/src/server.ts
git commit -m "fix(api): authenticate administrative sockets"
```

---

### Task 7: Website Firebase Email Authentication

**Repository:** `../website`

**Files:**
- Modify: `package.json`
- Modify: `config/firebaseConfig.ts`
- Replace: `config/apiClient.ts`
- Replace: `store/useAuthStore.ts`
- Modify: `app/login/page.tsx`
- Create: `vitest.config.ts`
- Create: `config/apiClient.test.ts`
- Create: `store/useAuthStore.test.ts`

**Interfaces:**
- Produces: Axios interceptor that calls `auth.currentUser.getIdToken()` and sets Bearer authorization.
- Produces: one forced refresh/retry on 401.
- Produces: auth state from `onAuthStateChanged`; no persisted authentication boolean.

- [ ] **Step 1: Add Vitest and write failing interceptor tests**

Test token attachment, no token for public requests, one forced refresh on 401, and Firebase sign-out after a second 401.

- [ ] **Step 2: Write failing auth-store tests**

Test Firebase email login, Firebase password-reset email, state restoration through `onAuthStateChanged`, `/auth/session` role `USER` requirement, and logout.

- [ ] **Step 3: Replace custom email and cookie session calls**

Use `signInWithEmailAndPassword`, `sendPasswordResetEmail`, `onAuthStateChanged`, and `signOut`. Remove refresh queues, `withCredentials`, API logout, and persisted auth state.

- [ ] **Step 4: Disable phone OTP until Group 2**

Hide or disable customer phone OTP controls with clear UI copy. Do not call Firebase SMS.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm test && npx tsc --noEmit && npm run build`

Expected: PASS with test Firebase environment values.

- [ ] **Step 6: Commit in website repository**

```bash
git add package.json package-lock.json config store app/login vitest.config.ts
git commit -m "feat(website): use Firebase bearer authentication"
```

---

### Task 8: Admin Firebase Login, TOTP Gate, and Socket Client

**Repository:** `../admin`

**Files:**
- Modify: `package.json`
- Replace: `src/config/apiClient.ts`
- Replace: `src/Store/authSlice/index.ts`
- Modify: `src/pages/Login.tsx`
- Modify: `src/components/ProtectedRoute.tsx`
- Replace: `src/config/socket.ts`
- Modify: `src/components/Header.tsx`
- Create: `src/components/auth/TotpEnrollment.tsx`
- Create: `src/components/auth/TotpChallenge.tsx`
- Create: `vitest.config.ts`
- Create: `src/config/apiClient.test.ts`
- Create: `src/Store/authSlice/index.test.ts`
- Create: `src/config/socket.test.ts`

**Interfaces:**
- Produces: Firebase email/password login only.
- Produces: auth phases `checking | signedOut | firebaseAuthenticated | mfaRequired | authenticated`.
- Produces: Socket.IO handshake `auth: callback => callback({ token })` after MFA.

- [ ] **Step 1: Write failing admin auth-phase tests**

Test wrong role rejection, TOTP enrollment requirement, TOTP challenge requirement, successful MFA, logout, and no route access before authenticated phase.

- [ ] **Step 2: Write failing admin API and socket tests**

Test Firebase Authorization header, `withCredentials` for MFA cookie, one token retry, socket token callback, and absence of `join-admins` emission.

- [ ] **Step 3: Implement Firebase email/password and TOTP screens**

Remove phone OTP and reCAPTCHA. After Firebase login call `/auth/session`, require ADMIN/COADMIN, then enroll or verify TOTP. Display recovery codes once and require explicit acknowledgement.

- [ ] **Step 4: Gate routes and sockets**

Protected routes require `authenticated`. Connect sockets only after MFA and disconnect on logout or token loss.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm test && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit in admin repository**

```bash
git add package.json package-lock.json src vitest.config.ts
git commit -m "feat(admin): require Firebase login and TOTP"
```

---

### Task 9: Full Security Regression and Build Verification

**Files:**
- Modify: `server/README.md` or create it if absent
- Modify: `website/.env.example`
- Modify: `admin/.env.example`
- Modify: `server/.env.example`
- Create: `server/src/security/group1.regression.test.ts`

**Interfaces:**
- Produces: one regression suite mapping each Group 1 bug to an executable assertion.
- Produces: exact environment contracts for local, CI, staging, and production builds.

- [ ] **Step 1: Add the Group 1 regression matrix**

Create named tests containing the bug IDs:

```ts
it("BUG-002 rejects public password mutation", async () => { /* 404 */ });
it("BUG-003 derives role from PostgreSQL", async () => { /* USER/ADMIN matrix */ });
it("BUG-004 has no production test-number bypass", async () => { /* removed route */ });
it("BUG-009 rejects anonymous admin sockets", async () => { /* connect_error */ });
it("BUG-010 requires bearer proof for state changes", async () => { /* 401 */ });
it("BUG-011 has no RSA session payload", async () => { /* no cookie/JWT flow */ });
it("BUG-012 enforces revocation, status, and current role", async () => { /* matrix */ });
it("BUG-013 has no custom refresh URL", async () => { /* removed route */ });
it("BUG-014 exposes no server password acceptance route", async () => { /* 404 */ });
it("BUG-015 uses strict proxy and CORS configuration", async () => { /* config */ });
```

- [ ] **Step 2: Run all API verification**

Run: `npx prisma generate && npm test && npm run typecheck && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Run all website verification**

Run in `../website`: `npm test && npx tsc --noEmit && npm run build`

Expected: all commands exit 0 with test Firebase environment variables.

- [ ] **Step 4: Run all admin verification**

Run in `../admin`: `npm test && npm run build`

Expected: all commands exit 0 with test Firebase environment variables.

- [ ] **Step 5: Scan commits for secrets and legacy auth**

Run repository-scoped searches for private keys, live Firebase service credentials, Razorpay live secrets, `update-password`, `refreshSession`, `encryptRSA`, `join-admins`, `idToken` cookies, and hard-coded test numbers.

Expected: no secret matches and no active legacy-auth matches.

- [ ] **Step 6: Commit documentation and regression suite**

```bash
git add server/README.md server/.env.example server/src/security/group1.regression.test.ts
git commit -m "test(api): verify Group 1 security regressions"
```

- [ ] **Step 7: Push all three repositories**

Push each `main` branch only after its own verification passes. Confirm local and remote commit hashes match.
