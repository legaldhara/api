import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("API automation", () => {
  it("verifies code and both container targets in CI", () => {
    const workflow = readFileSync("../.github/workflows/ci.yml", "utf8");
    for (const command of ["npm ci", "prisma validate", "npm test", "npm run typecheck", "npm run build", "validate.sh", "--target migration", "--target runtime"]) {
      expect(workflow).toContain(command);
    }
  });

  it("deploys only through manual protected exact-SHA execution", () => {
    const workflow = readFileSync("../.github/workflows/deploy-production.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("VPS_SSH_HOST_KEY");
    expect(workflow).toContain("deploy/scripts/deploy.sh");
    expect(workflow).toContain("^[0-9a-f]{40}$");
  });
});
