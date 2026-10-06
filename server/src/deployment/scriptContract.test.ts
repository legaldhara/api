import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readScript = (name: string) => readFileSync(`../deploy/scripts/${name}`, "utf8");

describe("production deployment scripts", () => {
  it("uses strict shell settings for every operation", () => {
    for (const name of ["backup-postgres.sh", "verify-backup.sh", "deploy.sh", "validate.sh"]) {
      const script = readScript(name);
      expect(script).toMatch(/^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/);
    }
  });

  it("backs up before a locked exact-SHA migration and health check", () => {
    const script = readScript("deploy.sh");
    expect(script).toContain("flock -n 9");
    expect(script).toContain("^[0-9a-f]{40}$");
    expect(script.indexOf("backup-postgres.sh predeploy")).toBeLessThan(script.indexOf("run --rm migrate"));
    expect(script).toContain("/health");
  });

  it("pauses traffic and verifies the backup before migrating", () => {
    const script = readScript("deploy.sh");
    const stopTraffic = script.indexOf("compose stop caddy");
    const backup = script.indexOf("backup-postgres.sh\" predeploy");
    const verify = script.indexOf("verify-backup.sh\" \"$BACKUP_FILE\"");
    const migrate = script.indexOf("compose run --rm migrate");

    expect(stopTraffic).toBeGreaterThan(-1);
    expect(stopTraffic).toBeLessThan(backup);
    expect(backup).toBeLessThan(verify);
    expect(verify).toBeLessThan(migrate);
  });

  it("fails closed after migration instead of starting the previous API", () => {
    const script = readScript("deploy.sh");
    expect(script).toContain('DEPLOY_PHASE="migration_started"');
    expect(script).toContain("Database migrations may have been applied");
    expect(script).toContain("compose stop caddy");
    expect(script).toContain("http://127.0.0.1:4001/health");
    expect(script).not.toContain('export IMAGE_TAG="$PREVIOUS_SHA"');
  });

  it("creates PostgreSQL custom-format backups", () => {
    const script = readScript("backup-postgres.sh");
    expect(script).toContain("--format=custom");
    expect(script).not.toMatch(/--password/);
  });
});
