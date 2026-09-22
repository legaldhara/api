import { z } from "zod";

export const serviceSchema = z.object({
  name: z.string().min(2, "Name is required"),
  note: z.string().optional(),
  description: z.string().optional(),
  benifits: z.string().optional(),
  governmentCharges: z.number().min(0, "Government charges must be >= 0").optional().default(0),
  price: z.number().min(0, "Price must be a non-negative number"),
  premiumPrice: z.number().min(0, "Premium price must be >= 0"),
  docRequired: z.array(z.string()).optional().default([]),
  deliverables: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateServiceSchema = z.object({
  name: z.string().min(2).optional(),
  note: z.string().optional(),
  description: z.string().optional(),
  benifits: z.string().optional(),
  premiumPrice: z.number().min(0, "Premium price must be >= 0").optional(),
  governmentCharges: z.number().min(0).optional(),
  price: z.number().min(0).optional(),
  docRequired: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});


export const directApplySchema = z.object({
  fullName: z.string().min(3, "Full name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(10, "Phone is required"),
  dob: z.string().optional(),
  gender: z.string().optional(),
  city: z.string().optional(),
  termsAccepted: z.boolean(),
  serviceId: z.string().uuid("Invalid service ID"),
  serviceFor: z.string().optional(),
  serviceName: z.string(),
  businessName: z.string().optional(),
  amount: z.number().min(0, "Price must be a non-negative number"),
});

