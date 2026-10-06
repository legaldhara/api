import { z } from "zod";

// ✅ User creates a certificate request
export const createCertificateRequestSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  subject: z.string().min(3, "Subject is required"),
  description: z.string().min(5, "Description is required"),
});

// ✅ Admin/User adds an update (message or certificate)
