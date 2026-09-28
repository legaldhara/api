import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("production dependency contract", () => {
  it("uses maintained authentication, mail, and IMAP clients", () => {
    expect(packageJson.dependencies["firebase-admin"]).toMatch(/^\^14\./);
    expect(packageJson.dependencies.nodemailer).toMatch(/^\^10\./);
    expect(packageJson.dependencies.imapflow).toBeDefined();
    expect(packageJson.dependencies["imap-simple"]).toBeUndefined();
  });

  it("does not install retired backup or UUID packages", () => {
    expect(packageJson.dependencies.exceljs).toBeUndefined();
    expect(packageJson.dependencies.uuidv4).toBeUndefined();
  });

  it("omits unused optional cloud packages from production images", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("FROM node:22-alpine");
    expect(dockerfile).toContain("npm ci --omit=optional");
    expect(dockerfile).toContain("npm ci --omit=dev --omit=optional");
    expect(readFileSync("../.github/workflows/ci.yml", "utf8")).toContain("node-version: 22");
    expect(readFileSync("../.github/workflows/deploy-production.yml", "utf8")).toContain("node-version: 22");
  });
});
