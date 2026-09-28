import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production API container", () => {
  it("separates migrations from non-root runtime startup", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("AS migration");
    expect(dockerfile).toContain("NODE_OPTIONS=--max-old-space-size=3072");
    expect(dockerfile).toContain('CMD ["npx", "prisma", "migrate", "deploy"]');
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toContain("pg-sdk-node");
    expect(dockerfile).not.toMatch(/migrate deploy && node/);
  });
});
