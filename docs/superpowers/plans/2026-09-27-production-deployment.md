# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the website and admin through Cloudflare Pages and deploy the API, Caddy, and a fresh private PostgreSQL database on the VPS from the three split repositories.

**Architecture:** The frontend repositories build independently as static Cloudflare Pages projects. The API repository owns a production Docker Compose stack where Caddy is the only public VPS service, migrations run as a one-off service, and a manually approved GitHub workflow deploys an exact commit SHA.

**Tech Stack:** Cloudflare Pages, GitHub Actions, Docker Compose, Caddy 2, Node.js 20, Express 5, Prisma 6, PostgreSQL 16, Next.js static export, Vite.

**Spec:** `docs/superpowers/specs/2026-09-27-production-deployment-design.md`

## Global Constraints

- Preserve all uncommitted Group 1 through Group 4 work.
- Do not commit, push, configure production accounts, modify DNS, deploy, or delete outer code during implementation.
- Caddy replaces Nginx and Certbot in the new API repository deployment.
- Use `legaldhara.com`, `admin.legaldhara.com`, and `api.legaldhara.com`; redirect `.in` to `.com`.
- Use Cloudflare Full (Strict), keep PostgreSQL private, and never print or commit secrets.
- API process startup must not run migrations; deployment runs migrations once before replacement.
- Production begins with a fresh database.
- Actual credential-based verification remains deferred until the user supplies access.

## File Map

- API runtime: `server/src/app.ts`, `server/Dockerfile`, `server/.dockerignore`.
- VPS stack: `deploy/Caddyfile`, `deploy/compose.production.yml`, `deploy/.env.production.example`.
- Operations: `deploy/scripts/*.sh`, `deploy/systemd/*`, `docs/deployment.md`.
- API automation: `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`.
- Website automation: `../website/.github/workflows/ci.yml`, `../website/docs/deployment.md`.
- Admin automation: `../admin/.github/workflows/ci.yml`, `../admin/docs/deployment.md`.

---

### Task 1: Add Explicit API Health Contracts

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/app.test.ts`

**Interfaces:**
- Produces `GET /health` for process liveness without dependency access.
- Produces `GET /ready` for PostgreSQL readiness.

- [x] **Step 1: Write failing endpoint tests**

```ts
it("reports liveness without querying PostgreSQL", async () => {
  const readinessProbe = vi.fn();
  const response = await request(createApp({ readinessProbe })).get("/health");
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "healthy" });
  expect(readinessProbe).not.toHaveBeenCalled();
});

it("reports 503 when PostgreSQL is unavailable", async () => {
  const readinessProbe = vi.fn().mockRejectedValue(new Error("offline"));
  const response = await request(createApp({ readinessProbe })).get("/ready");
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: "not_ready" });
});
```

- [x] **Step 2: Run RED**

Run from `server`: `npm test -- src/app.test.ts`.

Expected: FAIL because the endpoints and injectable readiness probe do not exist.

- [x] **Step 3: Implement the endpoint boundary**

Add an optional `readinessProbe(): Promise<void>` dependency to `createApp`; default it to `prisma.$queryRaw\`SELECT 1\``. Mount `/health` and `/ready` without changing the required raw-body Razorpay webhook order. Preserve the old `/api/appCheck` and `/api/dbCheck` routes temporarily.

- [x] **Step 4: Run GREEN and regression checks**

```powershell
npm test -- src/app.test.ts
npm test
npm run typecheck
```

Expected: all commands exit `0`.

---

### Task 2: Replace the Legacy API Container Build

**Files:**
- Replace: `server/Dockerfile`
- Create: `server/.dockerignore`
- Create: `server/src/deployment/containerContract.test.ts`

**Interfaces:**
- Produces Docker targets `migration` and `runtime`.
- Runtime starts `node dist/index.js` as user `node`.
- Migration runs only `npx prisma migrate deploy`.

- [x] **Step 1: Write a failing Dockerfile contract test**

```ts
const dockerfile = readFileSync("Dockerfile", "utf8");
expect(dockerfile).toContain("AS migration");
expect(dockerfile).toContain('CMD ["npx", "prisma", "migrate", "deploy"]');
expect(dockerfile).toContain("USER node");
expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
expect(dockerfile).not.toContain("pg-sdk-node");
expect(dockerfile).not.toMatch(/migrate deploy && node/);
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/deployment/containerContract.test.ts`.

Expected: FAIL against the legacy PhonePe-era Dockerfile.

- [x] **Step 3: Implement the multi-stage Dockerfile**

```dockerfile
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS migration
ENV NODE_ENV=production
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
USER node
EXPOSE 4001
CMD ["node", "dist/index.js"]
```

Create `server/.dockerignore` that excludes dependencies, output, tests, local environment files, logs, dumps, Git metadata, and editor files. It must retain `package-lock.json` and `prisma/migrations`.

- [x] **Step 4: Verify both targets**

```powershell
npm test -- src/deployment/containerContract.test.ts
docker build --target migration -t legaldhara-api:migration-test .
docker build --target runtime -t legaldhara-api:runtime-test .
docker image inspect legaldhara-api:runtime-test
```

Expected: test/builds pass and runtime image user is `node`.

---

### Task 3: Add Caddy and the Private Compose Stack

**Files:**
- Create: `deploy/Caddyfile`
- Create: `deploy/compose.production.yml`
- Create: `deploy/.env.production.example`
- Create: `server/src/deployment/composeContract.test.ts`
- Delete after replacement validation: `nginx/`
- Delete after replacement validation: root `docker-compose.yaml`

**Interfaces:**
- Produces `postgres`, `migrate`, `api`, and `caddy` services.
- Publishes only ports `80` and `443` from Caddy.
- Keeps PostgreSQL and API ports private.

- [x] **Step 1: Write a failing deployment contract test**

```ts
expect(compose).toContain("postgres:");
expect(compose).toContain("migrate:");
expect(compose).toContain("api:");
expect(compose).toContain("caddy:");
expect(compose).not.toMatch(/5432:5432/);
expect(compose).toContain('"80:80"');
expect(compose).toContain('"443:443"');
expect(caddyfile).toContain("{$API_DOMAIN:api.legaldhara.com}");
expect(caddyfile).toContain("reverse_proxy api:4001");
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/deployment/composeContract.test.ts`.

Expected: FAIL because `deploy/` is absent.

- [x] **Step 3: Create the production environment contract**

Define these non-secret defaults and append every remaining secret name from `server/.env.example` with blank values:

```dotenv
COMPOSE_PROJECT_NAME=legaldhara
API_DOMAIN=api.legaldhara.com
ACME_EMAIL=ops@legaldhara.com
IMAGE_TAG=local
PORT=4001
POSTGRES_USER=legaldhara
POSTGRES_PASSWORD=
POSTGRES_DB=legaldhara
DATABASE_URL=
CORS_ORIGINS=https://legaldhara.com,https://admin.legaldhara.com
ADMIN_APP_URL=https://admin.legaldhara.com
BACKUP_DIR=/var/backups/legaldhara
```

- [x] **Step 4: Implement `compose.production.yml`**

Use `postgres:16-alpine` with a named data volume, `pg_isready` health check, no `ports`, and internal network `data`. Build `migrate` from Docker target `migration`. Build/tag `api` from target `runtime`, expose only `4001`, and use a Node-based `/health` check. Use `caddy:2-alpine`, publish `80:80` and `443:443`, mount Caddy config/data/log volumes, and join only network `edge`. Configure bounded JSON logs (`10m`, five files) and `unless-stopped` for long-running services.

- [x] **Step 5: Implement the Caddyfile**

```caddyfile
{
  email {$ACME_EMAIL}
}

{$API_DOMAIN:api.legaldhara.com} {
  encode zstd gzip
  request_body {
    max_size 10MB
  }
  header {
    -Server
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
  }
  reverse_proxy api:4001 {
    health_uri /health
    health_interval 10s
    health_timeout 3s
    lb_try_duration 5s
  }
  log {
    output file /var/log/caddy/access.log {
      roll_size 10MiB
      roll_keep 10
      roll_keep_for 720h
    }
    format json
  }
}
```

Caddy must proxy Razorpay webhook bodies unchanged and rely on standard reverse proxy WebSocket support.

- [x] **Step 6: Validate and remove active legacy files**

```powershell
$env:ENV_FILE='deploy/.env.production.example'
docker compose -f deploy/compose.production.yml config
docker run --rm -e API_DOMAIN=api.legaldhara.com -e ACME_EMAIL=ops@legaldhara.com -v "${PWD}/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile
npm --prefix server test -- src/deployment/composeContract.test.ts
```

After all pass, delete the API repository's `nginx/` and root `docker-compose.yaml`. Do not touch outer monorepo files.

---

### Task 4: Add Backup, Restore, and Exact-SHA Deployment Scripts

**Files:**
- Create: `deploy/scripts/backup-postgres.sh`
- Create: `deploy/scripts/verify-backup.sh`
- Create: `deploy/scripts/deploy.sh`
- Create: `deploy/scripts/validate.sh`
- Create: `deploy/systemd/legaldhara-backup.service`
- Create: `deploy/systemd/legaldhara-backup.timer`
- Create: `server/src/deployment/scriptContract.test.ts`
- Delete after validation: root `backup.sh`
- Delete after validation: root `deploy.sh`

**Interfaces:**
- `backup-postgres.sh [predeploy|daily]` creates custom-format backups with retention.
- `verify-backup.sh <absolute-dump-path>` restores into an isolated temporary PostgreSQL container.
- `deploy.sh <40-character-sha>` deploys only that commit under an exclusive lock.

- [x] **Step 1: Write failing script contract tests**

Assert every script contains `#!/usr/bin/env bash` and `set -Eeuo pipefail`. Assert deployment uses `flock`, validates `^[0-9a-f]{40}$`, backs up before migration, runs `docker compose run --rm migrate`, and polls `/health`. Assert backup uses `pg_dump --format=custom` without putting the password in command arguments.

- [x] **Step 2: Run RED**

Run: `npm test -- src/deployment/scriptContract.test.ts`.

Expected: FAIL because the scripts do not exist.

- [x] **Step 3: Implement backup and retention**

The script resolves paths relative to itself, creates `${BACKUP_DIR}/{daily,weekly,monthly,predeploy}` with mode `0700`, confirms database health, writes to a temporary file, runs `pg_dump --format=custom --no-owner --no-privileges`, and atomically renames successful output. Daily retention is 7 days, weekly 28 days, monthly 186 days, and pre-deployment 14 days. It creates weekly copies on Sunday and monthly copies on day `01`; traps remove incomplete files and failures exit non-zero.

- [x] **Step 4: Implement isolated restore verification**

`verify-backup.sh` accepts only an existing absolute `.dump` path, starts a temporary `postgres:16-alpine` container and network with a generated local password, waits for readiness, restores the dump, runs `SELECT 1`, checks `_prisma_migrations`, and removes all temporary resources through an EXIT trap.

- [x] **Step 5: Implement locked exact-SHA deployment**

Begin with:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
DEPLOY_SHA="${1:?Usage: deploy.sh <40-character-commit-sha>}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 2; }
exec 9>/var/lock/legaldhara-deploy.lock
flock -n 9 || { echo "Another deployment is active" >&2; exit 3; }
```

Then fetch the exact commit, record current commit/image, create a pre-deployment backup when PostgreSQL is initialized, check out the approved commit detached, render Compose, build the SHA-tagged API image, start PostgreSQL, run the migration service once, replace API/Caddy, and poll `https://${API_DOMAIN}/health` with bounded retries. On failure, print bounded logs and restore the previous API image/commit without reversing database migrations.

- [x] **Step 6: Add validation and backup scheduling**

`validate.sh` runs `bash -n deploy/scripts/*.sh`, Compose rendering with the example env file, and `caddy adapt`. The systemd timer runs `/opt/legaldhara/api/deploy/scripts/backup-postgres.sh daily` at `02:30` with `Persistent=true`.

- [x] **Step 7: Run GREEN before deleting old scripts**

```bash
bash -n deploy/scripts/*.sh
./deploy/scripts/validate.sh
npm --prefix server test -- src/deployment/scriptContract.test.ts
```

After all pass, delete only the API repository's legacy root scripts.

---

### Task 5: Add API CI and Manual Production Deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `server/src/deployment/workflowContract.test.ts`

**Interfaces:**
- CI runs on pull requests and pushes to `main`.
- Production deployment runs only through `workflow_dispatch` and GitHub Environment `production`.
- SSH invokes `/opt/legaldhara/api/deploy/scripts/deploy.sh` with an exact SHA.

- [x] **Step 1: Write failing workflow contract tests**

Assert CI includes `npm ci`, Prisma validation, tests, typecheck, build, deployment validation, and both Docker targets. Assert deployment uses only `workflow_dispatch`, declares `environment: production`, validates the SHA, uses a pinned host key, and never uses `pull_request_target`.

- [x] **Step 2: Run RED**

Run: `npm test -- src/deployment/workflowContract.test.ts`.

Expected: FAIL because workflows are absent.

- [x] **Step 3: Implement API CI**

Use `actions/checkout@v4`, `actions/setup-node@v4`, Node 20, npm caching for `server/package-lock.json`, least-privilege `contents: read`, and concurrency cancellation. Run:

```yaml
- run: npm ci
  working-directory: server
- run: npx prisma validate
  working-directory: server
  env: { DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci" }
- run: npm test
  working-directory: server
- run: npm run typecheck
  working-directory: server
- run: npm run build
  working-directory: server
  env: { DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci" }
- run: bash deploy/scripts/validate.sh
- run: docker build --target migration -t legaldhara-api:migration-ci server
- run: docker build --target runtime -t legaldhara-api:runtime-ci server
```

- [x] **Step 4: Implement manual production deployment**

Accept `commit_sha`, defaulting to the triggering `main` SHA. Re-run API verification for that checkout, declare `environment: production`, write `VPS_SSH_PRIVATE_KEY` to a temporary `0600` file, populate `known_hosts` from `VPS_SSH_HOST_KEY`, and run:

```bash
ssh -i "$RUNNER_TEMP/deploy_key" "${VPS_SSH_USER}@${VPS_HOST}" \
  "cd /opt/legaldhara/api && ./deploy/scripts/deploy.sh '${DEPLOY_SHA}'"
```

Environment secrets: `VPS_HOST`, `VPS_SSH_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_HOST_KEY`. If required reviewers are unavailable for the private-repository GitHub plan, retain the administrator-only manual dispatch gate until that feature is available.

- [x] **Step 5: Run GREEN and API regression**

```powershell
npm test -- src/deployment/workflowContract.test.ts
npm test
npm run typecheck
npm run build
```

Expected: all commands exit `0`; actual SSH remains deferred.

---

### Task 6: Make the Website Cloudflare Pages Ready

**Files:**
- Create: `../website/.github/workflows/ci.yml`
- Modify: `../website/.env.example`
- Modify: `../website/lib/getApiBaseUrl.ts`
- Create: `../website/lib/getApiBaseUrl.test.ts`
- Create: `../website/public/_headers`
- Create: `../website/docs/deployment.md`

**Interfaces:**
- Uses only `NEXT_PUBLIC_BACKEND_API_URL` for the API origin.
- Builds static output into `out`.

- [x] **Step 1: Write failing API-origin tests**

Test that `getApiBaseUrl` returns `NEXT_PUBLIC_BACKEND_API_URL` regardless of browser hostname and reports a clear missing configuration outside development/test. Remove `.in`/`.com` branching from the expected contract.

- [x] **Step 2: Run RED**

Run: `npm test -- lib/getApiBaseUrl.test.ts`.

Expected: FAIL against the hostname-dependent helper.

- [x] **Step 3: Implement one canonical API variable**

Use `NEXT_PUBLIC_BACKEND_API_URL=https://api.legaldhara.com` in production. Remove `NEXT_PUBLIC_API_URL_IN` and `NEXT_PUBLIC_API_URL_COM` from `.env.example`; preserve Firebase public variables.

- [x] **Step 4: Add website CI**

Use Node 20 and npm cache; run `npm ci`, `npm test`, `npx tsc --noEmit`, and `npm run build`. The build receives `NEXT_PUBLIC_BACKEND_API_URL=https://api.example.invalid` and syntactically valid placeholder Firebase public values.

- [x] **Step 5: Add Pages headers and runbook**

`public/_headers` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive permissions policy, and `X-Frame-Options: SAMEORIGIN`. Defer CSP until Razorpay/Firebase/analytics origins are tested.

Document project `legaldhara-website`, repository `legaldhara/website`, branch `main`, build `npm run build`, output `out`, domain `legaldhara.com`, `.in`/`www` redirects preserving path/query, preview builds, and production API URL.

- [x] **Step 6: Run GREEN and full website checks**

```powershell
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: commands pass and `out/_headers` exists.

---

### Task 7: Make the Admin App Cloudflare Pages Ready

**Files:**
- Create: `../admin/.github/workflows/ci.yml`
- Modify: `../admin/.env.example`
- Create: `../admin/public/_redirects`
- Create: `../admin/public/_headers`
- Create: `../admin/docs/deployment.md`
- Create: `../admin/src/config/deploymentConfig.test.ts`

**Interfaces:**
- Uses `VITE_BACKEND_API_URL=https://api.legaldhara.com` for HTTP and Socket.IO.
- Produces Vite output in `dist` with SPA history fallback.

- [x] **Step 1: Write failing deployment contract tests**

Assert `.env.example` contains the canonical API variable, `_redirects` contains `/* /index.html 200`, `_headers` contains baseline security headers, and CI runs install, test, lint, typecheck, and build.

- [x] **Step 2: Run RED**

Run: `npm test -- src/config/deploymentConfig.test.ts`.

Expected: FAIL because Cloudflare files and CI are absent.

- [x] **Step 3: Add routing, headers, and CI**

Create `public/_redirects` with `/* /index.html 200`, use the same non-CSP headers as the website, and retain one API/Socket.IO origin. CI runs `npm ci`, `npm test`, `npm run lint:ci`, `npx tsc -b`, and `npm run build` with placeholder public Firebase values and `VITE_BACKEND_API_URL=https://api.example.invalid`. `lint:ci` uses unchanged rules on the payment and deployment surfaces; the 84-error legacy full-lint baseline is documented separately by user-approved scope.

- [x] **Step 4: Add the admin Pages runbook**

Document project `legaldhara-admin`, repository `legaldhara/admin`, branch `main`, React (Vite), build `npm run build`, output `dist`, domain `admin.legaldhara.com`, previews, and API origin. Explicitly state that `/admin` is retired.

- [x] **Step 5: Run GREEN and full admin checks**

```powershell
npm test
npm run lint:ci
npx tsc -b
npm run build
git diff --check
```

If lint reveals unrelated baseline issues, report them; do not weaken rules or claim CI is ready while it fails.

---

### Task 8: Write the Production Operations and Cutover Runbook

**Files:**
- Create: `docs/deployment.md`
- Modify: `server/docs/group-4-payment-operations.md`

**Interfaces:**
- Produces an executable operator sequence for provisioning, secrets, Cloudflare, deployment, backup, rollback, and old-code retirement.

- [x] **Step 1: Document exact production setup**

Cover VPS prerequisites, restricted deploy user, `/opt/legaldhara/api`, `/var/backups/legaldhara`, `.env.production` mode `0600`, GitHub Environment secret names, Cloudflare DNS/Pages/Full Strict settings, Firebase authorized domains, Razorpay webhook URL and event list, fresh-database migration, admin bootstrap, systemd timer installation, health/readiness checks, logs, rollback, and restore verification.

- [x] **Step 2: Document cutover and old-code retirement**

Require preview checks, API domain verification, auth/OTP/uploads/mail/Socket.IO/payment/refund tests, post-cutover monitoring, and successful backup verification before archiving and removing only the old outer `admin`, `server`, and `website` directories.

- [x] **Step 3: Link payment operations and scan documentation**

```powershell
rg -n "(BEGIN .*PRIVATE KEY|RAZORPAY_KEY_SECRET=.+|POSTGRES_PASSWORD=.+|FIREBASE_SERVICE_ACCOUNT_JSON=.+)" docs deploy server/.env.example
rg -n -i "nginx|certbot|phonepe|pg-sdk-node" docs deploy .github server/src
```

Expected: no populated secrets; legacy terms appear only in historical migration notes, not active instructions.

---

### Task 9: Full Credential-Free Deployment Verification

**Files:**
- Modify only files required to fix failures introduced by Tasks 1 through 8.

**Interfaces:**
- Produces verified deployment artifacts without configuring accounts or deploying.

- [x] **Step 1: Verify API and infrastructure**

```powershell
$env:DATABASE_URL='postgresql://ci:ci@localhost:5432/ci'
npx prisma validate
npm test
npm run typecheck
npm run build
docker build --target migration -t legaldhara-api:migration-test .
docker build --target runtime -t legaldhara-api:runtime-test .
```

From the API root, render Compose, adapt the Caddyfile, run `git diff --check`, and verify no `5432:5432`, Nginx, Certbot, PhonePe, or `pg-sdk-node` references exist in active deployment/source files.

- [x] **Step 2: Verify website**

Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` with placeholder browser-safe Firebase/API values.

- [x] **Step 3: Verify admin**

Run `npm test`, the approved deployment-scope `npm run lint:ci`, `npx tsc -b`, `npm run build`, and `git diff --check` with placeholder browser-safe Firebase/API values. Full-repository lint remains tracked legacy debt.

- [x] **Step 4: Record deferred external checks**

Record Cloudflare Git integration/domains/DNS, Full Strict TLS, GitHub secrets/reviewers, VPS SSH/firewall, fresh database initialization, restore drill, Firebase domains, SMTP/SMS/Cloudinary/Drive calls, and Razorpay test-mode checkout/webhook/reconciliation/refund as pending credentials.

- [x] **Step 5: Preserve the current workflow boundary**

Show `git status --short` in all three repositories. Do not commit, push, deploy, modify DNS, or remove outer code.
