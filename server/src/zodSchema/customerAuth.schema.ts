import { z } from "zod";

export const signupPhoneRequestSchema = z.object({
  phone: z.string().min(10).max(24),
});

export const signupPhoneVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const phoneLoginRequestSchema = signupPhoneRequestSchema;

export const phoneLoginVerifySchema = signupPhoneVerifySchema.extend({
  phone: z.string().min(10).max(24),
});

export const signupCompleteSchema = z.object({
  challengeId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(100),
  termsAccepted: z.literal(true),
  dob: z.coerce.date().optional(),
  gender: z.string().trim().min(1).max(30).optional(),
  city: z.string().trim().min(1).max(100).optional(),
});

export const normalizeIndianPhone = (input: string): string | null => {
  const digits = input.replace(/\D/g, "");
  const nationalNumber = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
  return /^[6-9]\d{9}$/.test(nationalNumber) ? `+91${nationalNumber}` : null;
};

