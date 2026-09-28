import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production edge stack", () => {
  it("keeps PostgreSQL private and exposes only Caddy", () => {
    const compose = readFileSync("../deploy/compose.production.yml", "utf8");
    const caddyfile = readFileSync("../deploy/Caddyfile", "utf8");

    for (const service of ["postgres:", "migrate:", "api:", "caddy:"]) {
      expect(compose).toContain(service);
    }
    expect(compose).not.toMatch(/5432:5432/);
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(caddyfile).toContain("{$API_DOMAIN:api.legaldhara.com}");
    expect(caddyfile).toContain("reverse_proxy api:4001");
    expect(caddyfile).toContain("health_uri /health");
  });

  it("keeps the production environment template parseable as dotenv", () => {
    const envTemplate = readFileSync("../deploy/.env.production.example", "utf8");
    const invalidLine = envTemplate
      .split(/\r?\n/)
      .find((line) => line.trim() && !line.trimStart().startsWith("#") && !/^[A-Z][A-Z0-9_]*=/.test(line));

    expect(invalidLine).toBeUndefined();
    expect(envTemplate).not.toContain("npm run admin:bootstrap");
  });
});
