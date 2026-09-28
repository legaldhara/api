# Production Deployment Design

## Goal

Deploy the website, admin panel, API, and PostgreSQL from the three new repositories while replacing the old monorepo Nginx deployment with Cloudflare Pages and a Caddy-based VPS origin.

## Repository Ownership

- `https://github.com/legaldhara/website.git` owns the public Next.js static export and its Cloudflare Pages build settings.
- `https://github.com/legaldhara/admin.git` owns the Vite admin application and its Cloudflare Pages build settings.
- `https://github.com/legaldhara/api.git` owns the API application and all VPS deployment assets under `deploy/`.
- No fourth infrastructure repository will be introduced.
- The old outer monorepo deployment remains intact until production cutover verification succeeds.

## Production Topology

```text
legaldhara.com       -> Cloudflare Pages -> website
legaldhara.in        -> permanent redirect to https://legaldhara.com
admin.legaldhara.com -> Cloudflare Pages -> admin
api.legaldhara.com   -> Cloudflare proxy -> Caddy on VPS -> API container -> PostgreSQL container
```

Cloudflare Pages serves both frontend applications directly. Frontend traffic does not pass through the VPS. Only the API hostname reaches the VPS.

## VPS Services

The API repository provides a production Docker Compose stack containing:

- `caddy`: the only service publishing host ports `80` and `443`.
- `api`: the compiled Node.js API on a private Docker network.
- `postgres`: PostgreSQL with a persistent named volume and no published host port.

Caddy uses a persistent data volume for certificate state. PostgreSQL uses a separate persistent data volume. Containers use restart policies, health checks, bounded logs, and explicit service dependencies.

## Caddy Reverse Proxy

Caddy serves `api.legaldhara.com`, obtains and renews the origin certificate automatically, and supports Cloudflare Full (Strict) TLS.

Caddy forwards all API paths, Razorpay webhook requests, and Socket.IO connections to the API container. The proxy must preserve request bodies and headers required for Razorpay signature verification. WebSocket upgrades are handled by Caddy's standard reverse proxy behavior.

The Caddy configuration also provides:

- response compression;
- security headers appropriate for an API origin;
- a request-body size limit aligned with the API upload policy;
- access and error logs with rotation;
- forwarding of the authenticated client address from Cloudflare;
- direct access to the API health endpoint through `https://api.legaldhara.com/health`.

## Cloudflare Pages

### Website

- Production branch: `main`.
- Build command: `npm ci && npm run build`.
- Output directory: `out`.
- Primary custom domain: `legaldhara.com`.
- `www.legaldhara.com` redirects to the primary domain.
- `legaldhara.in` and `www.legaldhara.in` permanently redirect to `https://legaldhara.com` while preserving the request path and query string.
- Production API variables point to `https://api.legaldhara.com`.

### Admin

- Production branch: `main`.
- Build command: `npm ci && npm run build`.
- Output directory: `dist`.
- Custom domain: `admin.legaldhara.com`.
- The old `/admin` path is not used in the new deployment.
- Production API and Socket.IO variables point to `https://api.legaldhara.com`.

Cloudflare preview deployments remain enabled for non-production branches and pull requests.

## CI and Release Control

Each repository has a GitHub Actions CI workflow that runs on pull requests and pushes to `main`.

Website CI runs dependency installation, tests, typechecking, and the static production build. Admin CI runs dependency installation, tests, linting, typechecking, and the production build. Cloudflare Pages deploys the corresponding `main` branch only after its configured build succeeds.

API CI runs dependency installation, Prisma validation and generation, tests, typechecking, production compilation, Docker image construction, and deployment-configuration validation.

API production deployment uses a protected GitHub Environment named `production`. A push to `main` may prepare a release, but deployment cannot begin until an authorized reviewer approves the environment job.

After approval, the workflow connects to the VPS through SSH and deploys the exact approved commit. The VPS deployment script:

1. acquires a deployment lock;
2. verifies required environment variables without printing secret values;
3. creates a pre-deployment PostgreSQL backup when a database already exists;
4. fetches the approved API commit;
5. builds the immutable API image;
6. starts PostgreSQL and waits for database readiness;
7. runs `prisma migrate deploy` as a one-off container;
8. starts or replaces the API container;
9. waits for the API health check through Caddy;
10. reports success or preserves diagnostics and the previous image for rollback.

The deployment script must fail immediately on command errors and must not use floating source state other than the commit supplied by the workflow.

## Database Initialization and Backups

Production starts with a fresh PostgreSQL database. The old `legaldhara_backup.dump` is retained as an archive but is not restored into the new schema.

The initial deployment applies the complete Prisma migration history before the API accepts production traffic.

Backups include:

- one backup before every API deployment when the database already contains a schema;
- one scheduled daily backup;
- timestamped compressed PostgreSQL custom-format files;
- retention of seven daily, four weekly, and six monthly backups;
- storage outside the PostgreSQL data volume;
- a restore verification command documented for operators.

Backup failures must produce a non-zero exit code. A deployment must stop when its required pre-deployment backup fails.

## Secrets

No production secret is committed to any repository or embedded in a frontend build unless it is explicitly a public browser configuration value.

- Cloudflare Pages stores public Firebase configuration and public API base URLs in project environment variables.
- GitHub's protected `production` environment stores the VPS host, SSH user, SSH private key, and deployment path.
- The VPS stores API, PostgreSQL, Firebase Admin, SMTP, Cloudinary, OTP, Razorpay, and session secrets in a root-readable production environment file outside Git.
- Caddy certificate data and PostgreSQL data remain in Docker volumes.
- Logs and workflow output must not print secret values.

## Security Boundaries

- PostgreSQL is not exposed through a host port.
- The API container is reachable only from the private Docker network and Caddy.
- CORS permits the production website and admin origins explicitly.
- Cloudflare SSL mode is Full (Strict).
- Razorpay webhook endpoints remain publicly reachable at the API hostname and retain exact raw-body verification.
- Docker containers run with the minimum practical privileges and receive only the secrets they require.
- Production deployment uses GitHub Environment approval and does not occur directly from an unreviewed workstation command.

## Health, Logs, and Rollback

The API exposes an unauthenticated health endpoint that confirms process readiness without exposing secrets. Docker and deployment checks use that endpoint.

Container logs use JSON-file size and file-count limits. Caddy access logs rotate independently. Deployment failures print bounded service diagnostics.

Cloudflare Pages handles frontend rollback through prior successful deployments. API rollback redeploys the previous known-good commit and image. Database migrations must be forward-compatible during a release; destructive schema cleanup is deferred to a later release after the older application version is no longer needed.

## Cutover Sequence

1. Verify CI, builds, Docker Compose, and Caddy configuration locally without production secrets.
2. Provision the VPS deployment directory, Docker volumes, production environment file, and SSH deployment identity.
3. Start PostgreSQL fresh and apply the complete Prisma migration history.
4. Deploy the API and verify direct health, CORS, Socket.IO, Firebase authentication, self-hosted OTP, uploads, mail, and admin MFA.
5. Run Razorpay test-mode checkout, webhook, duplicate-event, reconciliation, and full-refund tests.
6. Deploy website and admin preview builds using the production API hostname.
7. Configure `api.legaldhara.com` and verify Cloudflare-to-Caddy Full (Strict) TLS.
8. Attach the production frontend domains and configure `.in` and `www` redirects.
9. Monitor API health, Caddy logs, payment webhooks, authentication, and frontend errors after cutover.
10. Archive and remove the old outer application directories only after the production verification checklist passes.

## Acceptance Criteria

- The three new repositories build and test independently.
- Website and admin deploy independently through Cloudflare Pages.
- API deployment requires manual production approval.
- `api.legaldhara.com` is served through Cloudflare and Caddy with Full (Strict) TLS.
- Socket.IO and Razorpay raw-body webhooks work through Caddy.
- PostgreSQL has no public port and survives container replacement.
- Fresh-database migration, scheduled backup, restore verification, health checking, and rollback procedures are documented and executable.
- No deployment depends on the old outer `admin`, `server`, or `website` directories.
- Old code is not removed until production validation succeeds.
