import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared request lifecycle deployment", () => {
  it("ships lifecycle migrations, routes, and the email outbox worker", () => {
    const app = readFileSync("src/app.ts", "utf8");
    const server = readFileSync("src/server.ts", "utf8");
    const migrations = readdirSync("prisma/migrations");

    expect(app).toContain('app.use("/api/v1/cases", caseRouter)');
    expect(server).toContain("startCaseEmailOutboxJob()");
    expect(server).toContain("stopCaseEmailOutboxJob()");
    expect(migrations.some((name) => name.endsWith("_shared_request_lifecycle"))).toBe(true);
    expect(migrations.some((name) => name.endsWith("_remove_legacy_request_lifecycle"))).toBe(true);
  });

  it("documents the required rollout and rollback order", () => {
    const deployment = readFileSync("../docs/deployment.md", "utf8");
    const phases = [
      "1. Back up PostgreSQL.",
      "2. Deploy API image and run `prisma migrate deploy` before accepting new workflow traffic.",
      "3. Verify `/health`, case route authentication, and outbox worker logs.",
      "4. Deploy admin and run one administrator lifecycle smoke test.",
      "5. Deploy website and run one customer lifecycle smoke test.",
      "6. Roll back frontend builds first if a UI-only issue occurs.",
      "7. Keep traffic paused while validating the destructive cleanup migration.",
      "8. If validation fails before traffic resumes, restore the database backup and previous API/frontend images together.",
      "9. After traffic resumes, roll forward with a corrected Group 6 API image; do not run the pre-Group 6 API against the cleaned schema.",
    ];

    for (const phase of phases) expect(deployment).toContain(phase);
  });
});
