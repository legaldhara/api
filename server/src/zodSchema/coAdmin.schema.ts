import { z } from "zod";

export const inviteCoAdminSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
}).strict();

export const coAdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(100).optional(),
}).strict();

export const coAdminStatusSchema = z.object({ active: z.boolean() }).strict();