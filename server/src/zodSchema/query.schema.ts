import { z } from "zod";

export const userQuerySchema = z.object({
  fullName: z.string(),
  email: z.string().email("Invalid email"),
  phone: z.string(),
  subject: z.string().min(3, "Subject must be at least 3 characters"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});


export const resolveQuerySchema = z.object({
  response: z.string().min(1, "Response is required"),
});