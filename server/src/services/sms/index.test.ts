import { describe, expect, it, vi } from "vitest";
import { DevelopmentSmsProvider } from "./developmentSmsProvider";
import { HttpSmsProvider } from "./httpSmsProvider";
import { createSmsProvider } from "./index";

describe("SMS provider selection", () => {
  it("selects development delivery outside production", async () => {
    const deliveries: unknown[] = [];
    const provider = createSmsProvider(
      { NODE_ENV: "test", SMS_PROVIDER: "development" },
      { developmentSink: async (message) => { deliveries.push(message); } },
    );

    expect(provider).toBeInstanceOf(DevelopmentSmsProvider);
    await provider.sendOtp({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 });
    expect(deliveries).toEqual([{ phone: "+919876543210", code: "123456", expiresInSeconds: 300 }]);
  });

  it("rejects development delivery in production", () => {
    expect(() => createSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "development" }))
      .toThrow("Development SMS provider is disabled in production");
  });

  it("rejects incomplete httpSMS configuration", () => {
    expect(() => createSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "httpsms" }))
      .toThrow("httpSMS provider configuration is incomplete");
  });

  it("maps OTP delivery to the httpSMS API contract", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const provider = new HttpSmsProvider({
      baseUrl: "https://api.httpsms.com/v1",
      apiToken: "secret-api-token",
      deviceId: "+919111111111",
      fetcher,
    });

    await provider.sendOtp({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 });

    expect(fetcher).toHaveBeenCalledWith("https://api.httpsms.com/v1/messages/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": "secret-api-token",
      },
      body: JSON.stringify({
        from: "+919111111111",
        to: "+919876543210",
        content: "LegalDhara code: 123456. Valid for 5 min.",
      }),
    });
  });

  it("throws a secret-free delivery error", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const provider = new HttpSmsProvider({
      baseUrl: "https://api.httpsms.com/v1",
      apiToken: "never-leak-this-token",
      deviceId: "+919111111111",
      fetcher,
    });

    await expect(provider.sendOtp({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 }))
      .rejects.toThrow("SMS delivery failed with status 401");
    await expect(provider.sendOtp({ phone: "+919876543210", code: "123456", expiresInSeconds: 300 }))
      .rejects.not.toThrow(/never-leak-this-token|123456/);
  });
});
