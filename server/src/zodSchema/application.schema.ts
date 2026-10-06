import { z } from "zod";

export const applicationSchema = z.object({
  serviceId: z.string().uuid({ message: "Invalid service ID" }),
  serviceName: z.string().optional(),
  serviceFor: z.string().optional(),
  businessName: z.string().optional(),
});
