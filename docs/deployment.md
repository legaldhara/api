# Production Deployment Operations

## Topology

- `legaldhara.com`: Cloudflare Pages website.
- `admin.legaldhara.com`: Cloudflare Pages admin.
- `api.legaldhara.com`: Cloudflare proxy to Caddy on the VPS.
- Caddy proxies to the private API container.
- PostgreSQL is reachable only on the internal Docker network.

## VPS Prerequisites

Use a maintained Ubuntu VPS with Docker Engine, the Docker Compose plugin, Git, curl, openssl, and util-linux (`flock`). Create a restricted `legaldhara-deploy` user with only the Docker and repository permissions required by the deployment scripts.

Create:

```bash
sudo install -d -o legaldhara-deploy -g legaldhara-deploy /opt/legaldhara
sudo install -d -m 0700 -o legaldhara-deploy -g legaldhara-deploy /var/backups/legaldhara
sudo -u legaldhara-deploy git clone https://github.com/legaldhara/api.git /opt/legaldhara/api
```

Allow inbound SSH from trusted administration addresses and HTTP/HTTPS on ports `80` and `443`. Do not open PostgreSQL port `5432`.

## Production Environment

Copy `deploy/.env.production.example` to `/opt/legaldhara/api/deploy/.env.production`, set mode `0600`, and populate every required value. Keep this file outside Git history and readable only by the deployment account.

Required secret families include PostgreSQL, Firebase Admin, MFA/OTP encryption and signing, SMS, Razorpay, Cloudinary, SMTP/IMAP, and Google Drive. Set:

```dotenv
API_DOMAIN=api.legaldhara.com
CORS_ORIGINS=https://legaldhara.com,https://admin.legaldhara.com
ADMIN_APP_URL=https://admin.legaldhara.com
BACKUP_DIR=/var/backups/legaldhara
```

## GitHub Production Environment

Create the API repository environment `production`. Enable required reviewers and prevent self-review when the GitHub plan supports it. Add:

- `VPS_HOST`
- `VPS_SSH_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_SSH_HOST_KEY`

The host-key secret contains the verified complete `known_hosts` line obtained through a trusted channel. Production deploys are manually initiated with a full commit SHA.

## Cloudflare

Connect the website and admin repositories using the settings in their `docs/deployment.md` files. Create a proxied DNS record for `api.legaldhara.com` pointing to the VPS and set SSL/TLS mode to Full (Strict). Attach `legaldhara.com` and `admin.legaldhara.com` to their Pages projects. Redirect `.in` and `www` hostnames to the canonical `.com` website while preserving path and query.

Add `legaldhara.com` and `admin.legaldhara.com` to Firebase authorized domains. Set the Razorpay webhook URL to:

```text
https://api.legaldhara.com/api/v1/payments/webhooks/razorpay
```

Enable captured/failed payment events and processed/failed refund events.

## First Deployment

1. Verify the production environment file and DNS.
2. From GitHub Actions, run `Deploy API Production` with the approved full SHA.
3. The script starts fresh PostgreSQL, builds immutable images, applies all migrations with `prisma migrate deploy`, starts API/Caddy, and verifies `/health`.
4. Verify `https://api.legaldhara.com/health` and `/ready`.
5. Run the admin bootstrap command inside a one-off API build environment using the documented bootstrap variables; do not place bootstrap credentials in shell history.
6. Install and enable the backup timer:

```bash
sudo cp deploy/systemd/legaldhara-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now legaldhara-backup.timer
```

## Operations

```bash
cd /opt/legaldhara/api
ENV_FILE=.env.production docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
ENV_FILE=.env.production docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs --tail 200 api caddy
deploy/scripts/backup-postgres.sh daily
deploy/scripts/verify-backup.sh /absolute/path/to/backup.dump
```

Inspect timer state with `systemctl status legaldhara-backup.timer`. Validate Caddy changes before reload with `caddy adapt`; deploy through the approved workflow rather than editing production configuration manually.

## Group 6 Lifecycle Rollout

1. Back up PostgreSQL.
2. Deploy API image and run `prisma migrate deploy` before accepting new workflow traffic.
3. Verify `/health`, case route authentication, and outbox worker logs.
4. Deploy admin and run one administrator lifecycle smoke test.
5. Deploy website and run one customer lifecycle smoke test.
6. Roll back frontend builds first if a UI-only issue occurs.
7. Keep traffic paused while validating the destructive cleanup migration.
8. If validation fails before traffic resumes, restore the database backup and previous API/frontend images together.
9. After traffic resumes, roll forward with a corrected Group 6 API image; do not run the pre-Group 6 API against the cleaned schema.

## Rollback

For releases without destructive migrations, re-run the production workflow with the previous known-good full commit SHA. The deployment script keeps SHA-tagged images and restores the prior API image if the new health check fails. Do not reverse production migrations automatically. Group 6 is the exception described above: once its cleanup migration is validated and traffic resumes, roll forward instead of starting a pre-Group 6 API against the cleaned schema.

## Cutover Verification

Verify website/admin previews first, then confirm production:

- Firebase signup/login and session refresh;
- self-hosted email/phone OTP and rate limiting;
- admin MFA and CoAdmin permissions;
- mail, uploads, protected file access, Cloudinary, and Google Drive;
- Socket.IO through Caddy;
- Razorpay test checkout, raw webhook, duplicate webhook, reconciliation, duplicate payment, and full refund;
- daily backup creation and isolated restore verification;
- Caddy/API logs and Cloudflare error dashboards.

## Credential-Gated Checks

The following checks remain pending until production accounts, credentials, and infrastructure access are provided:

- Cloudflare Git integrations, Pages domains, DNS redirects, and Full (Strict) TLS;
- GitHub production secrets, required reviewers, and manual exact-SHA approval;
- VPS SSH access, firewall rules, and the fresh PostgreSQL initialization;
- daily backup execution and an isolated restore drill;
- Firebase authorized domains and live signup/login flows;
- SMTP, SMS, Cloudinary, and Google Drive integrations;
- Razorpay test-mode checkout, webhook, reconciliation, duplicate-payment handling, and refund flows.

## Old-Code Retirement

Do not delete the outer `admin`, `server`, or `website` directories until cutover checks pass, current code is pushed to all three new repositories, production backups are verified, and rollback SHAs are recorded. Archive the old deployment configuration and database dump before deleting only those duplicate application directories.
