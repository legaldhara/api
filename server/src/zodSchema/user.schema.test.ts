import { describe, expect, it } from "vitest";
import { updateUserProfileSchema } from "./user.schema";

describe("profile update validation", () => {
  it.each(["email", "phone", "role", "isActive", "emailVerified", "uid"])("rejects the protected %s field", (field) => {
    const result = updateUserProfileSchema.safeParse({ fullName: "Valid Name", [field]: "attacker-value" });
    expect(result.success).toBe(false);
  });

  it("requires at least one editable profile field", () => {
    expect(updateUserProfileSchema.safeParse({}).success).toBe(false);
  });

  it("trims bounded editable text", () => {
    const result = updateUserProfileSchema.safeParse({ fullName: "  Valid Name  ", city: "  Delhi  " });
    expect(result).toMatchObject({ success: true, data: { fullName: "Valid Name", city: "Delhi" } });
  });

  it("rejects a future date of birth", () => {
    expect(updateUserProfileSchema.safeParse({ dob: "2999-01-01" }).success).toBe(false);
  });
});
