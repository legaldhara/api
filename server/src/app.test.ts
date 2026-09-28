import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";

describe("createApp", () => {
  it("serves health checks without opening a port", async () => {
    const response = await request(createApp()).get("/api/appCheck");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("healthy");
  });

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
});
