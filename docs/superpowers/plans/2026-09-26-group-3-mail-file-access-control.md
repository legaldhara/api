# Group 3 Mail and File Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close bugs 056–060 by securing mail, tracking uploaded-file ownership, restricting profile edits, and adding primary-admin-controlled co-admin onboarding.

**Architecture:** PostgreSQL records become authoritative for uploaded asset ownership and administrator invitations, while Cloudinary and Firebase remain provider adapters. Express composes authentication, role, and MFA middleware at router boundaries; the React admin app consumes narrow co-admin and MFA-enrollment APIs and never receives secrets except one-time enrollment material.

**Tech Stack:** Express 5, TypeScript, Prisma/PostgreSQL, Firebase Admin/Auth, Cloudinary, Nodemailer/IMAP, Zod 4, Vitest/Supertest, React 19, Redux Toolkit, Axios, Vite.

**Spec:** `docs/superpowers/specs/2026-09-26-group-3-mail-file-access-control-design.md`

## Global Constraints

- Preserve all uncommitted Group 1 and Group 2 changes.
- Do not commit, push, or deploy; those actions remain deferred until all groups and local integration testing are complete.
- Only `ADMIN` may list, invite, activate, deactivate, or resend invitations for `COADMIN` accounts.
- Administrative API operations require a current MFA proof.
- Uploads allow at most four files, at most 10 MB each, and only JPEG, PNG, WebP, or PDF.
- Generic profile updates must reject email, phone, role, active-state, verification, and Firebase identity fields.
- Tests must fail for the intended missing behavior before production code is written.
- Provider credentials are not required for unit and route tests; Firebase, Cloudinary, SMTP, and IMAP calls use injectable adapters or mocks.

## File Structure

- `server/prisma/schema.prisma`: authoritative asset and invitation persistence.
- `server/src/services/uploadedAsset.ts`: asset creation, claiming, deletion authorization, and provider compensation.
- `server/src/services/cloudStorage.ts`: narrow Cloudinary upload/delete adapter.
- `server/src/services/adminIdentity.ts`: narrow Firebase co-admin lifecycle adapter.
- `server/src/services/coAdmin.ts`: local/Firebase invitation orchestration and compensation.
- `server/src/services/Mail.ts`: reliable mail provider behavior that propagates failures.
- `server/src/controller/*.ts`: HTTP translation only; business decisions stay in services.
- `server/src/zodSchema/*.ts`: strict request contracts.
- `admin/src/features/coadmins/*`: API types, state hook, and management UI.
- `admin/src/components/auth/AdminMfaFlow.tsx`: login verification and first-login enrollment UI.

---

### Task 1: Persist Managed Assets and Invitations

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260926110000_group3_access_control/migration.sql`
- Create: `server/src/services/uploadedAsset.test.ts`
- Create: `server/src/services/uploadedAsset.ts`

**Interfaces:**
- Produces: `registerUploadedAsset(input)`, `claimUploadedAsset(input)`, and `authorizeTemporaryAssetDeletion(input)`.
- Produces Prisma models `UploadedAsset` and `AdminInvitation` plus enums `AssetStatus`, `AssetContext`, and `InvitationDeliveryStatus`.

- [ ] **Step 1: Write failing asset lifecycle tests**

```ts
it("rejects claiming an asset owned by another user", async () => {
  assetRepository.findById.mockResolvedValue({ id: "asset-1", ownerId: "user-2", status: "TEMPORARY" });
  await expect(claimUploadedAsset({ assetId: "asset-1", actor: userOne, context: "DOCUMENT", referenceId: "doc-1" }, deps))
    .rejects.toMatchObject({ statusCode: 403 });
});

it("allows ADMIN to delete another user's temporary asset", async () => {
  assetRepository.findById.mockResolvedValue({ id: "asset-1", ownerId: "user-2", status: "TEMPORARY" });
  await expect(authorizeTemporaryAssetDeletion({ assetId: "asset-1", actor: admin }, deps)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/services/uploadedAsset.test.ts`

Expected: FAIL because `uploadedAsset.ts` and its exported functions do not exist.

- [ ] **Step 3: Add the Prisma records and service contracts**

```prisma
model UploadedAsset {
  id             String       @id @default(uuid()) @db.Uuid
  ownerId        String       @db.Uuid
  publicId       String       @unique
  secureUrl      String
  resourceType   String
  mimeType       String
  originalName   String
  sizeBytes      Int
  status         AssetStatus  @default(TEMPORARY)
  context        AssetContext?
  referenceId    String?
  attachedAt     DateTime?
  deletedAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  owner          User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)
}

model AdminInvitation {
  id             String                   @id @default(uuid()) @db.Uuid
  userId         String                   @unique @db.Uuid
  deliveryStatus InvitationDeliveryStatus
  lastSentAt     DateTime?
  lastErrorAt    DateTime?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt
  user           User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Implement explicit domain errors with `statusCode` and keep Prisma access behind a dependency object so lifecycle rules are testable without a database.

- [ ] **Step 4: Generate Prisma client and run the focused test**

Run: `npx prisma generate`

Run: `npm test -- src/services/uploadedAsset.test.ts`

Expected: PASS.

### Task 2: Lock Down Operational Mail

**Files:**
- Create: `server/src/zodSchema/mail.schema.test.ts`
- Modify: `server/src/zodSchema/mail.schema.ts`
- Create: `server/src/routes/mail.route.test.ts`
- Modify: `server/src/routes/mail.route.ts`
- Modify: `server/src/controller/mail.controller.ts`
- Modify: `server/src/services/Mail.ts`

**Interfaces:**
- Consumes: existing `authenticate`, `authorize`, `requireAdminMfa`, and persistent `consumeRateLimit` service.
- Produces: strict `sendMailSchema` and bounded `receiveMailQuerySchema`.

- [ ] **Step 1: Write failing schema and route-security tests**

```ts
it("rejects more than ten recipients", () => {
  expect(sendMailSchema.safeParse({ to: Array.from({ length: 11 }, (_, index) => `u${index}@example.com`), subject: "Notice", text: "Body" }).success).toBe(false);
});

it("requires authentication before sending mail", async () => {
  await request(app).post("/api/v1/mail/send").send({ to: "a@example.com", subject: "S", text: "B" }).expect(401);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/zodSchema/mail.schema.test.ts src/routes/mail.route.test.ts`

Expected: FAIL because the current schema is unbounded and the router is public.

- [ ] **Step 3: Implement strict validation and middleware composition**

```ts
router.use(authenticate);
router.use(authorize("ADMIN", "COADMIN"));
router.use(requireAdminMfa);
router.post("/send", asyncHandler(sendMailController));
router.get("/receive", asyncHandler(receiveMailController));
```

Normalize a single recipient to an array, cap subject/content lengths, require text or HTML, reject unknown fields, cap inbox limit, and apply the database-backed rate limiter before provider calls. Change `MailService.send` to throw provider failures rather than swallowing them.

- [ ] **Step 4: Run mail tests**

Run: `npm test -- src/zodSchema/mail.schema.test.ts src/routes/mail.route.test.ts`

Expected: PASS.

### Task 3: Enforce Upload Policy and Ownership

**Files:**
- Create: `server/src/config/uploadPolicy.test.ts`
- Modify: `server/src/config/cloudinary.ts`
- Create: `server/src/services/cloudStorage.ts`
- Create: `server/src/routes/media.route.test.ts`
- Modify: `server/src/routes/media.route.ts`
- Modify: `server/src/controller/media.controller.ts`
- Modify: `server/src/controller/document.controller.ts`
- Modify: `server/src/controller/application.controller.ts`
- Modify: `server/src/controller/certificate.controller.ts`
- Modify: `admin/src/hooks/uploadImages.ts`
- Modify: `admin/src/pages/Applications.tsx`
- Modify: `admin/src/components/AdminCertificateModal.tsx`

**Interfaces:**
- Consumes: Task 1 asset lifecycle functions.
- Produces: upload results `{ assetId, url, publicId, mimeType, sizeBytes }` and deletion route `DELETE /api/v1/media/:assetId`.

- [ ] **Step 1: Write failing upload-policy tests**

```ts
it.each(["text/html", "image/svg+xml", "application/zip"])("rejects %s", (mimeType) => {
  expect(isAllowedUpload({ mimetype: mimeType, originalname: "payload.bin" })).toBe(false);
});

it("rejects a fifth file", async () => {
  const call = request(app).post("/api/v1/media/upload");
  for (let index = 0; index < 5; index += 1) call.attach("files", Buffer.from("x"), `file-${index}.png`);
  await call.expect(400);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/config/uploadPolicy.test.ts src/routes/media.route.test.ts`

Expected: FAIL because MIME/extension limits, internal asset IDs, and ownership checks are absent.

- [ ] **Step 3: Implement server-owned upload policy**

```ts
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 4, fileSize: 10 * 1024 * 1024, fields: 4, fieldSize: 16 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, isAllowedUpload(file)),
});
```

Generate folders as `users/<userId>/temporary` or `admins/<userId>/temporary`; ignore body folder values. On partial Cloudinary failure, delete already-uploaded objects. Persist every success before returning it.

- [ ] **Step 4: Implement asset-ID deletion and claim integration**

Use `DELETE /api/v1/media/:assetId`. Authorize through Task 1, delete from Cloudinary using the stored public ID/resource type, then mark the asset deleted. Update document, application, and certificate attachment paths to claim referenced `assetId` values before persisting attachment data.

- [ ] **Step 5: Update admin upload consumers**

Replace deletion calls that interpolate `publicId` with the returned `assetId`. Keep `publicId` only where an existing domain payload still needs it during the compatibility transition.

- [ ] **Step 6: Run upload and adjacent controller tests**

Run: `npm test -- src/config/uploadPolicy.test.ts src/routes/media.route.test.ts`

Expected: PASS.

### Task 4: Restrict Generic Profile Updates

**Files:**
- Create: `server/src/zodSchema/user.schema.test.ts`
- Modify: `server/src/zodSchema/user.schema.ts`
- Create: `server/src/routes/userProfile.route.test.ts`
- Modify: `server/src/controller/user.controller.ts`

**Interfaces:**
- Produces: strict `updateUserProfileSchema` containing only `fullName`, `dob`, `gender`, and `city`.

- [ ] **Step 1: Write failing allowlist tests**

```ts
it.each(["email", "phone", "role", "isActive", "emailVerified", "uid"])("rejects %s", (field) => {
  expect(updateUserProfileSchema.safeParse({ fullName: "Valid Name", [field]: "attacker-value" }).success).toBe(false);
});

it("requires at least one editable field", () => {
  expect(updateUserProfileSchema.safeParse({}).success).toBe(false);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/zodSchema/user.schema.test.ts src/routes/userProfile.route.test.ts`

Expected: FAIL because email and phone are currently accepted and unknown keys are stripped.

- [ ] **Step 3: Implement strict schema and safe projection**

```ts
export const updateUserProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  dob: z.iso.date().optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  city: z.string().trim().min(2).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one profile field is required");
```

Update only parsed fields, validate DOB is not in the future, and return a safe profile projection.

- [ ] **Step 4: Run profile tests**

Run: `npm test -- src/zodSchema/user.schema.test.ts src/routes/userProfile.route.test.ts`

Expected: PASS.

### Task 5: Add Primary-Admin Co-admin APIs

**Files:**
- Create: `server/src/zodSchema/coAdmin.schema.ts`
- Create: `server/src/services/adminIdentity.ts`
- Create: `server/src/services/coAdmin.test.ts`
- Create: `server/src/services/coAdmin.ts`
- Create: `server/src/controller/coAdmin.controller.ts`
- Create: `server/src/routes/coAdmin.route.test.ts`
- Create: `server/src/routes/coAdmin.route.ts`
- Modify: `server/src/app.ts`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `inviteCoAdmin`, `resendCoAdminInvitation`, `setCoAdminActive`, and paginated `listCoAdmins`.
- Produces routes under `/api/v1/admin/coadmins`, all protected by `authenticate`, `authorize("ADMIN")`, and `requireAdminMfa`.

- [ ] **Step 1: Write failing orchestration tests**

```ts
it("deletes a newly created Firebase identity when local creation fails", async () => {
  identity.create.mockResolvedValue({ uid: "firebase-1" });
  repository.create.mockRejectedValue(new Error("database unavailable"));
  await expect(inviteCoAdmin(input, deps)).rejects.toThrow("database unavailable");
  expect(identity.remove).toHaveBeenCalledWith("firebase-1");
});

it("records retryable delivery failure without returning the setup link", async () => {
  mail.send.mockRejectedValue(new Error("smtp unavailable"));
  const result = await inviteCoAdmin(input, deps);
  expect(result).toMatchObject({ invitationStatus: "FAILED" });
  expect(JSON.stringify(result)).not.toContain("oobCode");
});
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `npm test -- src/services/coAdmin.test.ts`

Expected: FAIL because the orchestration service does not exist.

- [ ] **Step 3: Implement Firebase adapter and invitation orchestration**

Generate a cryptographically random undisclosed password, create an email-verified disabled-safe Firebase identity, create the local `COADMIN`, generate a password-reset link using `ADMIN_APP_URL`, and send a fixed internal template. Compensate Firebase creation when local persistence fails. Store `SENT` or `FAILED` invitation delivery status without storing the link.

- [ ] **Step 4: Write failing route authorization tests**

```ts
it("blocks COADMIN from inviting another co-admin", async () => {
  await authenticatedRequest(coadmin).post("/api/v1/admin/coadmins/invite").send(validInvite).expect(403);
});

it("blocks ADMIN without MFA", async () => {
  await authenticatedRequest(admin).post("/api/v1/admin/coadmins/invite").send(validInvite).expect(403);
});
```

- [ ] **Step 5: Implement routes, validation, and status synchronization**

Prevent self-targeting and primary-admin targeting. Activation/deactivation must update Firebase and PostgreSQL consistently, with compensation or a retryable provider error if either side fails.

- [ ] **Step 6: Run co-admin tests**

Run: `npm test -- src/services/coAdmin.test.ts src/routes/coAdmin.route.test.ts`

Expected: PASS.

### Task 6: Complete First-login MFA Enrollment

**Files:**
- Modify: `server/src/controller/session.controller.ts`
- Modify: `server/src/controller/adminMfa.controller.ts`
- Modify: `server/src/controller/adminMfa.controller.test.ts`
- Create: `admin/src/components/auth/AdminMfaFlow.tsx`
- Create: `admin/src/components/auth/AdminMfaFlow.test.tsx`
- Modify: `admin/src/config/apiClient.ts`
- Modify: `admin/src/pages/Login.tsx`
- Modify: `admin/src/hooks/useAuthListener.ts`

**Interfaces:**
- Produces session flags `mfaEnrolled` and `mfaVerified`.
- Produces admin client methods `enrollMfa`, `confirmMfa`, and `verifyMfa`.

- [ ] **Step 1: Write failing session and controller tests**

```ts
it("reports an administrative account without MFA as unenrolled", async () => {
  prisma.adminSecurity.findUnique.mockResolvedValue(null);
  await getSession(requestFor(coadmin), response);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ mfaEnrolled: false, mfaVerified: false }));
});
```

- [ ] **Step 2: Run API MFA tests and confirm RED**

Run: `npm test -- src/controller/adminMfa.controller.test.ts`

Expected: FAIL because the session does not expose enrollment state.

- [ ] **Step 3: Implement enrollment-state response and strict MFA payloads**

Query `AdminSecurity.enabledAt`, distinguish enrollment from verification, and validate six-digit TOTP/recovery-code request bodies before service calls.

- [ ] **Step 4: Add admin component test tooling and write failing flow tests**

Install only the existing-stack test dependencies needed by Vite React tests: Vitest, jsdom, Testing Library React, and jest-dom. Add `test` script and Vitest setup without replacing the build configuration.

```tsx
it("starts enrollment when the session says MFA is not enrolled", async () => {
  render(<AdminMfaFlow session={{ mfaEnrolled: false, mfaVerified: false }} api={api} onComplete={onComplete} />);
  expect(await screen.findByText(/scan/i)).toBeInTheDocument();
  expect(api.enrollMfa).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: Run the component test and confirm RED**

Run: `npm test -- src/components/auth/AdminMfaFlow.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement verification/enrollment UI**

Render login, enrollment, confirmation, recovery-code display, and verification as explicit states. Keep secrets in component state only; clear them on completion/unmount; never use localStorage or Redux for secrets.

- [ ] **Step 7: Run API and admin MFA tests**

Run in API: `npm test -- src/controller/adminMfa.controller.test.ts`

Run in admin: `npm test -- src/components/auth/AdminMfaFlow.test.tsx`

Expected: PASS.

### Task 7: Build the Admin-only Co-admin Screen

**Files:**
- Create: `admin/src/features/coadmins/types.ts`
- Create: `admin/src/features/coadmins/api.ts`
- Create: `admin/src/features/coadmins/CoAdminPage.tsx`
- Create: `admin/src/features/coadmins/CoAdminPage.test.tsx`
- Modify: `admin/src/Store/authSlice/index.ts`
- Modify: `admin/src/hooks/useAuthListener.ts`
- Modify: `admin/src/components/ProtectedRoute.tsx`
- Modify: `admin/src/components/PanelLayout.tsx`
- Modify: `admin/src/lib/static.ts`
- Modify: `admin/src/components/RouterContent.tsx`
- Modify: `admin/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 co-admin endpoints and authenticated role from Redux.
- Produces: `/co-admins` route visible and usable only by `ADMIN`.

- [ ] **Step 1: Write failing role-visibility and interaction tests**

```tsx
it("does not show co-admin management to COADMIN", () => {
  renderAdminShell({ role: "COADMIN" });
  expect(screen.queryByRole("link", { name: /co-admins/i })).not.toBeInTheDocument();
});

it("invites a co-admin and refreshes the list", async () => {
  render(<CoAdminPage api={api} />);
  await user.type(screen.getByLabelText(/full name/i), "Operations Admin");
  await user.type(screen.getByLabelText(/email/i), "ops@example.com");
  await user.click(screen.getByRole("button", { name: /send invitation/i }));
  expect(api.invite).toHaveBeenCalledWith({ fullName: "Operations Admin", email: "ops@example.com" });
});
```

- [ ] **Step 2: Run the component tests and confirm RED**

Run: `npm test -- src/features/coadmins/CoAdminPage.test.tsx`

Expected: FAIL because the feature files and role-aware navigation do not exist.

- [ ] **Step 3: Preserve role in authenticated admin state**

Add `role: "ADMIN" | "COADMIN"` to the auth state, populate it from session responses, and make route guards redirect non-primary admins from `/co-admins`.

- [ ] **Step 4: Implement co-admin API client and page**

Implement paginated search, invitation form, invitation retry, active-state controls, confirmation dialogs, stable loading/error/empty states, and refresh after mutations. Do not render provider identifiers or setup links.

- [ ] **Step 5: Add role-aware route, header, and sidebar item**

Register `/co-admins` in `App.tsx`; derive sidebar entries from the current role; add a matching route header. API authorization remains authoritative.

- [ ] **Step 6: Run co-admin UI tests**

Run: `npm test -- src/features/coadmins/CoAdminPage.test.tsx`

Expected: PASS.

### Task 8: Regression and Build Verification

**Files:**
- Modify: `server/.env.example`
- Create: `server/docs/group-3-access-control.md`
- Modify: `admin/.env.example` if the existing file requires the admin return URL.

**Interfaces:**
- Documents: `ADMIN_APP_URL`, mail limits, upload limits, provider prerequisites, migration order, and deferred real-service checks.

- [ ] **Step 1: Run focused Group 3 API tests**

Run: `npm test -- src/services/uploadedAsset.test.ts src/zodSchema/mail.schema.test.ts src/routes/mail.route.test.ts src/config/uploadPolicy.test.ts src/routes/media.route.test.ts src/zodSchema/user.schema.test.ts src/routes/userProfile.route.test.ts src/services/coAdmin.test.ts src/routes/coAdmin.route.test.ts src/controller/adminMfa.controller.test.ts`

Expected: all Group 3 tests PASS.

- [ ] **Step 2: Run the full API suite and static checks**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Run the admin suite and static checks**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0; pre-existing unrelated warnings may be reported but not fixed in this group.

- [ ] **Step 4: Run repository hygiene checks**

Run in API and admin: `git diff --check`

Run in API and admin: `git status --short`

Expected: no whitespace errors; all Group 3 files remain uncommitted and no unrelated file is modified.

- [ ] **Step 5: Record deferred integration checks**

Document that real Firebase invitation links, Cloudinary upload/delete behavior, SMTP/IMAP access, PostgreSQL migration execution, and browser-level admin flows will be tested after the user supplies the required environment values, before commit/push/deployment.
