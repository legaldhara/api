# Group 3: Mail and File Access Control Design

## Scope

Group 3 resolves bugs 056 through 060:

- BUG-056: unauthenticated mail relay and inbox access
- BUG-057: file deletion based only on a caller-supplied Cloudinary public ID
- BUG-058: incomplete server-side upload limits and file validation
- BUG-059: profile updates can replace verified email and phone identifiers
- BUG-060: missing co-admin management and onboarding flow

This work affects the API and admin repositories. The customer website receives only compatibility changes if API response shapes require them.

## Security Principles

1. Authentication alone does not grant administrative privileges; administrative actions require an allowed role and a current MFA proof.
2. External storage identifiers are implementation details, not authorization credentials.
3. The server owns file policy, folder selection, and attachment state.
4. Verified login identifiers cannot be changed through a generic profile endpoint.
5. Only `ADMIN` can manage `COADMIN` accounts. A `COADMIN` cannot create, activate, deactivate, or invite another administrator.
6. Temporary credentials, invitation links, recovery codes, and mail secrets must not be logged.

## Authorization Matrix

| Capability | USER | COADMIN | ADMIN |
| --- | --- | --- | --- |
| Send operational mail | No | MFA required | MFA required |
| Read operational inbox | No | MFA required | MFA required |
| Upload allowed files | Own account | MFA required | MFA required |
| Delete own unattached upload | Yes | Yes | Yes |
| Delete another account's upload | No | No | Yes |
| Delete an attached upload through media endpoint | No | No | No |
| Update own non-identity profile fields | Yes | Yes | Yes |
| List or manage co-admins | No | No | MFA required |

## Mail Access Control

### Routes

The existing `/api/v1/mail` router will require:

1. Firebase authentication
2. `ADMIN` or `COADMIN` role
3. a valid admin MFA proof

`POST /api/v1/mail/send` remains an operational admin feature but no longer acts as a public relay. Its request body will be strict and bounded:

- one to ten recipients
- a bounded subject
- bounded text or HTML content, with at least one content field required
- a fixed sender alias from the existing allowlist
- unknown properties rejected

The endpoint will use persistent rate limiting so limits work across API instances. Responses will not expose SMTP or IMAP details.

`GET /api/v1/mail/receive` will validate and cap the requested message count. Returned messages will contain only the fields required by the admin UI.

System-generated mail and co-admin invitations will call the mail service internally rather than call the public HTTP endpoint. `MailService.send` must propagate delivery failures so callers can handle partial provisioning safely.

## Managed Uploads

### Data Model

Add an `UploadedAsset` model containing:

- internal UUID
- owner user ID
- Cloudinary public ID and secure URL
- resource type and MIME type
- original filename and byte size
- lifecycle status: `TEMPORARY`, `ATTACHED`, or `DELETED`
- optional attachment context and reference ID
- creation, attachment, and deletion timestamps

Cloudinary public IDs remain unique in the database. API responses expose the internal asset ID for later deletion and attachment. Existing response fields may remain temporarily for frontend compatibility, but authorization never relies on them.

### Upload Policy

`POST /api/v1/media/upload` accepts:

- at most four files per request
- at most 10 MB per file
- JPEG, PNG, WebP, and PDF only
- bounded multipart field sizes

The server generates the Cloudinary folder from the authenticated account and never trusts `req.body.folder`. File type checks use both declared MIME type and recognized extension; unsupported content is rejected before Cloudinary upload. Upload failures clean up any files already uploaded during that request.

The endpoint creates one `UploadedAsset` record per successful upload. Administrative upload requests continue to require MFA.

### Attachment and Deletion

Domain controllers that accept uploaded files must claim assets before storing their URLs or public IDs. Claiming verifies that:

- the asset exists and is `TEMPORARY`
- the actor owns it, or the actor is an authorized administrator acting within that domain flow
- the requested attachment context matches the domain operation

Claimed assets become `ATTACHED`. The generic media deletion endpoint refuses to delete attached assets. Attached-file removal must happen through the owning document, application, or certificate operation so database state and Cloudinary remain synchronized.

The deletion endpoint receives an internal asset ID. Owners may delete their own temporary uploads. `ADMIN` may delete any temporary upload. `COADMIN` cannot delete another actor's upload. Successful deletion marks the record `DELETED`; a repeated request is idempotent. Cloudinary `not found` is treated as already deleted, while other provider failures leave the database record unchanged.

## Profile Update Restrictions

`PUT /api/v1/user/update` will accept only:

- `fullName`
- `dob`
- `gender`
- `city`

The schema will be strict, trim text, apply practical length limits, validate dates, and require at least one field. `email`, `phone`, `role`, `isActive`, verification fields, and Firebase identifiers are rejected rather than ignored.

Email and phone changes require dedicated re-verification flows and are intentionally outside this generic profile endpoint. This group prevents unsafe changes; it does not add those future change-identifier flows.

The response returns the safe profile projection only. Database uniqueness and validation failures use stable client-safe errors without leaking internal details.

## Co-admin Management

### API

Add an `/api/v1/admin/coadmins` router protected by authentication, `ADMIN` authorization, and MFA.

Endpoints:

- `GET /` lists co-admins with pagination and search.
- `POST /invite` creates and emails a co-admin invitation.
- `POST /:id/invitation` resends a setup invitation.
- `PATCH /:id/status` activates or deactivates a co-admin.

The list response includes identity, active status, invitation state, MFA enrollment state, creation date, and last login. It never returns Firebase internals, MFA secrets, recovery-code hashes, or invitation links.

### Invitation Flow

The administrator supplies a full name and email. The API:

1. validates that neither a local user nor Firebase user already conflicts
2. generates a high-entropy password that is never returned or logged
3. creates a Firebase user with the invited email
4. creates the local `COADMIN` record
5. generates a Firebase password-reset link pointing back to the configured admin application
6. sends a fixed invitation template through the internal mail service

Because the random password is undisclosed, account access requires control of the invited mailbox. The Firebase user may be marked email-verified during provisioning because the undisclosed credential cannot be used and the setup link is delivered only to that mailbox.

Provisioning includes compensation: if local account creation fails, remove the newly created Firebase user; if invitation delivery fails, preserve the safely inaccessible account and return a retryable invitation state rather than exposing the setup link.

Deactivation updates both the local account and Firebase disabled state. Reactivation updates both systems. The API prevents an administrator from targeting their own account through co-admin endpoints and prevents changes to primary `ADMIN` records.

### Admin Application

Add an `ADMIN`-only Co-admin Management page containing:

- searchable, paginated co-admin list
- status, MFA state, invitation state, creation date, and last-login columns
- invite form for name and email
- resend invitation action
- activate and deactivate actions with confirmation
- loading, empty, success, and failure states

The sidebar and route are visible only to `ADMIN`. Client-side hiding is usability only; API authorization remains authoritative.

### First-login MFA

The admin session response will indicate whether MFA is enrolled. After Firebase password login:

- enrolled administrators enter a TOTP or recovery code
- unenrolled administrators start the existing MFA enrollment flow
- the UI displays the QR/secret, confirms the first TOTP, and displays recovery codes once
- dashboard access is granted only after enrollment confirmation produces a valid MFA proof

Recovery codes must be shown once and never stored in browser persistence.

## Error Handling and Audit Safety

- Validation errors return `400`; missing authentication returns `401`; insufficient role or MFA returns `403`; missing resources return `404`; conflicts return `409`; provider failures return `502` where retrying is appropriate.
- Logs include operation identifiers and safe account IDs, not mail content, credentials, invitation links, OTP/TOTP values, recovery codes, or storage secrets.
- Provider calls are wrapped behind small service functions so tests do not need Firebase, Cloudinary, SMTP, or IMAP credentials.
- Multi-system operations explicitly handle compensation and partial failure instead of claiming success before all required state is durable.

## Testing Strategy

### API

- mail routes reject anonymous, non-admin, non-MFA, oversized, and rate-limited requests
- upload middleware rejects too many, oversized, or unsupported files
- upload ignores client folders and records server-owned metadata
- deletion enforces owner, role, temporary state, and idempotency rules
- asset claiming rejects foreign, deleted, attached, and context-mismatched assets
- profile updates reject identity and privilege fields while accepting valid safe fields
- co-admin routes enforce `ADMIN` plus MFA and prevent self-targeting
- invitation tests cover conflicts, Firebase failure, database failure compensation, mail failure, resend, activation, and deactivation
- session and MFA tests cover first-login enrollment and recovery-code login

### Admin

- route and sidebar visibility follow the current authenticated role
- list, invite, resend, activate, and deactivate interactions render server outcomes correctly
- destructive actions require confirmation
- first-login MFA enrollment does not persist secrets or recovery codes

### Verification

Run targeted tests first, followed by full API and admin test suites, TypeScript checks, lint where already configured, production builds, and `git diff --check`. Real Firebase, Cloudinary, SMTP, IMAP, and database integration tests remain deferred until the required credentials are supplied, matching the agreed project workflow.

## Out of Scope

- customer email-change and phone-change verification flows
- a general-purpose marketing or bulk-mail system
- direct browser-to-Cloudinary uploads
- permanent file retention and archival policy
- Git commits, pushes, and deployment before all groups and local integration testing are complete
