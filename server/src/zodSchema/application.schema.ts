import { optional, z } from "zod";
import { ApplicationStatus } from "@prisma/client";

export const applicationSchema = z.object({
  serviceId: z.string().uuid({ message: "Invalid service ID" }),
  serviceName: z.string().optional(),
  serviceFor: z.string().optional(),
  businessName: z.string().optional(),
});

export const updateApplicationSchema = z.object({
  applicationStatus: z.nativeEnum(ApplicationStatus).optional(),
  objectionReason: z.string().optional(),
  autoCloseAt: z.string().datetime().optional(),
});

export const applicationUpdateSchema = z.object({
  message: z.string().min(1, "Update message is required"),
  paymentId: z.string().uuid({ message: "Invalid payment ID" }).optional(),
  updateCharges: z.number().min(0, "Update charges must be positive").optional(),
  prevStatus: z.nativeEnum(ApplicationStatus),
  newStatus: z.nativeEnum(ApplicationStatus),
  type: z.enum(["INITIAL", "ADDITIONAL", "CORRECTION", "OBJECTION"]).optional(),
  meta: z.object({}).optional(),
});