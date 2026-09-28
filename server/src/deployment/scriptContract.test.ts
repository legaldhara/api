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

  it("creates PostgreSQL custom-format backups", () => {
    const script = readScript("backup-postgres.sh");
    expect(script).toContain("--format=custom");
    expect(script).not.toMatch(/--password/);
  });
});
