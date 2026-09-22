# Group 1 Authentication and Session Security Design

Date: 2026-09-23

## Objective

Replace LegalDhara's custom JWT, RSA, refresh-token, cookie, and production test-number authentication with Firebase Authentication as the identity provider. Every protected API request must verify the Firebase identity and then load the current LegalDhara user from PostgreSQL before authorization.

This design covers BUG-002, BUG-003, BUG-004, BUG-009, BUG-010, BUG-011, BUG-012, BUG-013, BUG-014, and BUG-015. It also implements the approved admin authentication direction: Firebase email/password, mandatory self-hosted TOTP, and compatibility with Cloudflare Access at deployment time.

## Scope

### Included

- Firebase ID-token authentication for the API, website, admin panel, and Socket.IO.
- PostgreSQL as the authoritative source for LegalDhara role and active status.
- Removal of custom access JWTs, refresh JWTs, RSA session encryption, and authentication cookies.
- Removal of public password mutation, legacy login, refresh, validation, and test-number bypass routes.
- Firebase email/password login and Firebase password-reset email for the website and admin panel.
- Admin-only TOTP enrollment, verification, recovery codes, and step-up enforcement.
- Strict CORS configuration and removal of the cookie-based CSRF exposure.
- Security-focused automated tests through implementation Step 9.

### Excluded

- Self-hosted customer SMS OTP and customer signup redesign, which belong to Group 2.
- Cloudflare Access policy configuration and production deployment, which belong to Step 10 and Group 7.
- Payment ownership, mail routes, file access, and workflow changes from later groups.
- Migration of existing users because the project has no existing users.

## Chosen Architecture

### Identity

Firebase Authentication is the only password and identity authority. Frontends obtain a short-lived Firebase ID token and send it on every protected request:

`Authorization: Bearer <firebase-id-token>`

The API verifies the token with Firebase Admin using revocation checking. It then loads the user by Firebase `uid` from PostgreSQL and rejects users who are missing, inactive, or not allowed for the route. Firebase answers who the caller is; PostgreSQL answers what the caller may do.

No LegalDhara password hashes, custom access tokens, refresh tokens, or RSA-encrypted authentication payloads remain in the active flow.

### Authorization

The request authentication context contains only server-derived values:

- LegalDhara user ID
- Firebase UID
- current PostgreSQL role
- current active status
- verified email and phone values supplied by Firebase where available

Clients cannot choose or override a role. `authorize("USER")` protects customer-only routes, while `authorize("ADMIN", "COADMIN")` protects administrative routes. Role and active status are loaded on every request so deactivation and demotion apply immediately.

### Admin TOTP

Admin and co-admin accounts are provisioned out of band; there is no public admin registration route. A one-time CLI/bootstrap command creates the Firebase email/password account and matching PostgreSQL user with a verified administrative role.

After Firebase login, an administrator must enroll or verify TOTP before accessing administrative APIs. TOTP secrets are encrypted at rest with a dedicated environment key. Recovery codes are randomly generated and stored only as hashes.

Successful TOTP verification creates a short-lived signed proof in an HttpOnly, Secure, SameSite=Strict, host-only cookie named `__Host-admin_mfa`. This cookie is not an identity session and is useless without a valid Firebase bearer token. Admin APIs and the admin Socket.IO connection require both proofs. Customer APIs never use this cookie.

The MFA proof expires after eight hours, is bound to the Firebase UID, and is cleared on admin logout. Changing an admin role, disabling the user, resetting TOTP, or revoking Firebase sessions invalidates access.

## API Changes

### Authentication middleware

The middleware will:

1. Require a correctly formed Bearer token.
2. Verify it through Firebase Admin with revocation checking.
3. Load the matching PostgreSQL user by `uid`.
4. Reject missing or inactive users with a generic unauthorized response.
5. Attach the current server-derived authentication context.
6. Never trust role, user ID, email, or phone values from request bodies.

Firebase initialization will fail fast at application startup if credentials or the project ID are invalid. The server must not continue in a partially authenticated state.

### Auth routes

The active HTTP surface becomes:

- `GET /api/v1/auth/session`: returns the current PostgreSQL user after Firebase authentication.
- `POST /api/v1/auth/admin/mfa/enroll`: creates a pending TOTP enrollment for an authenticated ADMIN or COADMIN.
- `POST /api/v1/auth/admin/mfa/confirm`: confirms the first TOTP code and returns recovery codes once.
- `POST /api/v1/auth/admin/mfa/verify`: verifies TOTP or a recovery code and sets the MFA proof cookie.
- `POST /api/v1/auth/admin/logout`: clears the MFA proof cookie; the frontend also signs out from Firebase.

The following legacy routes are removed:

- `/validate`
- `/admin/login`
- `/user/login-by-phone`
- `/user/login-by-email`
- `/refresh`
- `/user/register`
- `/user/update-password`
- `/logout`
- `/coadmin/register`

Customer registration and self-hosted phone OTP return in Group 2 through verified flows. Firebase handles password reset; the API never accepts a new password from an unauthenticated caller.

### Socket.IO

The client sends the current Firebase ID token in the Socket.IO handshake. Server middleware verifies Firebase, loads PostgreSQL role/status, and checks the admin MFA cookie. Only an active ADMIN or COADMIN is joined automatically to `ADMINS`.

The unauthenticated `join-admins` event is removed. Failed authentication rejects the connection without revealing account details.

### CORS and CSRF

CORS origins come only from a validated comma-separated environment variable. Production does not include localhost or wildcard origins. The typoed `.in` origin is removed.

Website requests use bearer tokens and do not send credentials. Admin requests may send credentials only for the host-only MFA proof cookie and must also include a valid Firebase bearer token. A cross-site request cannot supply that Authorization header, so the MFA cookie alone cannot authorize an action.

The API accepts JSON request bodies for authenticated operations. URL-encoded parsing is removed unless a documented external integration needs a narrowly scoped exception later.

`trust proxy` is configured explicitly for the single Caddy proxy so request IPs and future rate limiting use the real client address.

## Database Changes

The `User.uid` field becomes required and unique for active accounts. `password` is no longer used and is removed because there are no existing users to migrate.

An `AdminSecurity` model stores:

- `userId` as a unique relation to `User`
- encrypted pending or active TOTP secret
- TOTP enabled timestamp
- hashed recovery codes
- last successful TOTP time step to reject immediate replay
- created and updated timestamps

The existing `Token` model is no longer used for access or refresh sessions. It remains temporarily only if required by FCM notification storage; no authentication flow writes to it. Authentication-token schema cleanup can be completed safely without coupling it to notification work.

## Website Changes

- Email/password login uses Firebase `signInWithEmailAndPassword`.
- Password reset uses Firebase `sendPasswordResetEmail`.
- Authentication state comes from `onAuthStateChanged`, not a persisted boolean in localStorage.
- The Axios request interceptor obtains the current Firebase token and sets the Authorization header.
- On a 401 response it forces one Firebase token refresh and retries once; a second failure signs out.
- The custom refresh endpoint, cookie credentials, RSA session assumptions, and API logout call are removed.
- Phone OTP controls are disabled until Group 2 replaces Firebase SMS with self-hosted httpSMS.

## Admin Changes

- Admin login uses Firebase email/password only.
- After Firebase login, the admin loads `/auth/session` and is rejected unless the PostgreSQL role is ADMIN or COADMIN.
- The first login presents TOTP enrollment; later logins present TOTP verification.
- Administrative screens remain inaccessible until both Firebase and TOTP checks succeed.
- API requests attach the Firebase bearer token and include credentials only for the MFA proof cookie.
- Socket.IO connects only after MFA success and sends the current Firebase token in the handshake.
- Logout clears Firebase state, disconnects Socket.IO, and clears the MFA proof cookie.

## Error Handling

Authentication responses do not reveal whether an email, phone, UID, role, or account exists. Expected responses are:

- `401 Authentication required` for missing, malformed, expired, revoked, unknown, or inactive identities.
- `403 Insufficient permissions` for an authenticated user with the wrong role.
- `403 MFA required` for an administrator who has not completed TOTP.
- `429 Too many attempts` for TOTP verification limits.

Detailed Firebase and TOTP failures are logged server-side without tokens, secrets, recovery codes, query strings, or personal data.

## Test Strategy

The API is separated into an app factory and a server entry point so tests can run without opening the production port. Vitest and Supertest cover HTTP middleware and routes; Socket.IO client tests cover handshake authorization. Firebase Admin and Prisma are mocked at unit boundaries.

Required security tests include:

- Missing, malformed, expired, and revoked Firebase tokens return 401.
- A valid Firebase token with no PostgreSQL user returns 401.
- Inactive users return 401.
- USER cannot access admin routes and ADMIN cannot use customer-only identity paths where restricted.
- Role changes in PostgreSQL take effect on the next request.
- Removed password-reset, refresh, custom-login, and test-number routes are unavailable.
- TOTP enrollment requires an admin role.
- Admin APIs reject missing, expired, mismatched, or forged MFA proofs.
- A TOTP code cannot be replayed in the same time step.
- Recovery codes are one-time use.
- Anonymous and USER sockets cannot join `ADMINS`.
- Active administrators with Firebase and MFA proofs join `ADMINS`.
- Disallowed CORS origins are rejected and production configuration contains no localhost wildcard.

Frontend tests cover Firebase token attachment, one-time 401 retry, logout on repeated failure, non-persisted authentication state, admin MFA gating, and authenticated Socket.IO options.

## Implementation Sequence Through Step 9

1. Add test infrastructure and refactor server startup for testability.
2. Add failing API authentication and authorization tests.
3. Implement Firebase bearer-token middleware and PostgreSQL role/status checks.
4. Remove legacy JWT, RSA, refresh, password, test-number, and cookie flows.
5. Add admin TOTP persistence, enrollment, verification, recovery, and enforcement.
6. Authenticate Socket.IO and remove `join-admins`.
7. Update website Firebase email login, password reset, auth state, and API interceptor.
8. Update admin Firebase email login, TOTP gate, API interceptor, and socket client.
9. Run focused tests, full type checks, production builds with test environment configuration, and security regression tests.

Production staging, Cloudflare Access configuration, and deployment are Step 10 and begin only after Step 9 is accepted.

## Acceptance Criteria

- No active route accepts a password, refresh token, role, or user identity as proof from the request body.
- No custom access JWT, refresh JWT, RSA session encryption, or authentication cookie remains.
- Every protected HTTP and Socket.IO action verifies Firebase and current PostgreSQL status/role.
- Every admin HTTP and Socket.IO action additionally requires current TOTP proof.
- All Group 1 regression tests pass.
- API, website, and admin type checks and builds pass with documented test environment variables.
- No secrets or generated credentials are committed.
