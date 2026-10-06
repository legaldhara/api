import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readScript = (name: string) => readFileSync(`../deploy/scripts/${name}`, "utf8");
const scriptNames = ["backup-postgres.sh", "verify-backup.sh", "deploy.sh", "validate.sh"];

describe("production deployment scripts", () => {
  it("uses strict shell settings for every operation", () => {
    for (const name of scriptNames) {
      const script = readScript(name);
      expect(script).toMatch(/^#!\/usr\/bin\/env bash\nset -E?euo pipefail/);
    }
  });

  it("tracks every deployment script as executable", () => {
    const repository = resolve("..");
    const safeDirectory = repository.replaceAll("\\", "/");
    const output = execFileSync(
      "git",
      ["-c", `safe.directory=${safeDirectory}`, "ls-files", "--stage", ...scriptNames.map((name) => `deploy/scripts/${name}`)],
      { cwd: repository, encoding: "utf8" },
    );

    for (const line of output.trim().split(/\r?\n/)) expect(line).toMatch(/^100755 /);
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

  it("does not inherit the failure handler inside backup output capture", () => {
    const script = readScript("deploy.sh");
    expect(script).toMatch(/^#!\/usr\/bin\/env bash\nset -euo pipefail/);
    expect(script).not.toContain('BACKUP_FILE="$(ENV_FILE=');
    expect(script).toContain('> "$BACKUP_RESULT_FILE"');
  });

  it("creates PostgreSQL custom-format backups", () => {
    const script = readScript("backup-postgres.sh");
    expect(script).toContain("--format=custom");
    expect(script).not.toMatch(/--password/);
  });
});
