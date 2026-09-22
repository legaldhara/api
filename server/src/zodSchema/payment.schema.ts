import { z } from "zod";

export const paymentSchema = z.object({
    applicationId: z.string().uuid("Invalid service ID"),
    serviceId: z.string().uuid("Invalid service ID"),
    paymentMethod: z.string(),
    amount: z.number().min(0, "Amount should be greater than 0"),
    paymentType: z.enum(['INITIAL', 'OBJECTION', 'ADDITIONAL', 'CORRECTION']).optional()
})

export const initiatePaymentSchema = z.object({
    ticketNo: z.string(),
    amount: z.number().min(0, "Amount should be greater than 0"),  
    paymentType: z.enum(['INITIAL', 'ADDITIONAL',])
});

export const initiateCertificatePaymentSchema = z.object({
    requestNo: z.string(),
    amount: z.number().min(0, "Amount should be greater than 0"),  
    paymentType: z.enum(['ADDITIONAL']).optional()
})

