import z from "zod";

const recipients = z.union([
  z.string().email().transform((value) => [value]),
  z.array(z.string().email()).min(1).max(10),
]);

export const sendMailSchema = z.object({
  to: recipients,
  subject: z.string().trim().min(1, "Subject is required").max(200),
  text: z.string().max(20_000).optional(),
  html: z.string().max(50_000).optional(),
  aliasFrom: z.enum(["info", "support", "contact"]).optional().default("info"),
}).strict().refine((value) => Boolean(value.text?.trim() || value.html?.trim()), {
  message: "Text or HTML content is required",
});

export const receiveMailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
}).strict();