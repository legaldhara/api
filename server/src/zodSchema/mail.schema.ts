import z from "zod";

export const sendMailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1, "Subject is required"),
  text: z.string().optional(),
  html: z.string().optional(),
  aliasFrom: z.enum(["info", "support", "contact"]).optional().default("info"),
});

