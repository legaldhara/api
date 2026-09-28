import { describe, expect, it } from "vitest";
import { receiveMailQuerySchema, sendMailSchema } from "./mail.schema";

describe("mail request validation", () => {
  it("rejects more than ten recipients", () => {
    const result = sendMailSchema.safeParse({
      to: Array.from({ length: 11 }, (_, index) => `user${index}@example.com`),
      subject: "Service notice",
      text: "Message body",
    });
    expect(result.success).toBe(false);
  });

  it("requires text or HTML content", () => {
    expect(sendMailSchema.safeParse({ to: "user@example.com", subject: "Service notice" }).success).toBe(false);
  });

  it("rejects unknown fields instead of silently accepting them", () => {
    expect(sendMailSchema.safeParse({
      to: "user@example.com",
      subject: "Service notice",
      text: "Message body",
      from: "attacker@example.com",
    }).success).toBe(false);
  });

  it("caps inbox reads at fifty messages", () => {
    expect(receiveMailQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(receiveMailQuerySchema.safeParse({ limit: "50" }).success).toBe(true);
  });
});
