import { z } from "zod";

export const userRegisterSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  city: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Confirm Password must be at least 6 characters"),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  dob: z
    .string()
    .nullable()
    .optional()
    .refine(val => !val || !isNaN(Date.parse(val)), {
      message: "Invalid date format",
    }),
}).superRefine((data, ctx) => {
  if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match",
    });
  }
});

export const updateUserProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.email().optional(),
  phone: z.string().min(10).max(15).optional(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD")
    .optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  city: z.string().min(2).optional(),
});


export const updateUserPasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
  confirmPassword: z.string().min(6)
});


export const userLoginByEmailAndPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const userLoginByPhoneSchema = z.object({
  phone: z
    .string()
    .min(10)
    .max(15)
    .refine((val) => /^\+?[0-9]{10,13}$/.test(val), "Invalid phone number"),
});