import { Request, Response } from "express";
import { prisma } from "../config/db";
import { Decimal } from "@prisma/client/runtime/library";
import Phonepe from "../services/PhonePe";
import { logger } from "../utils/logger";
import { Prisma } from "@prisma/client";
import { PaymentStatus } from "@prisma/client";
import Razorpay from "../services/Razorpay";


export const getPlans = async (req: Request, res: Response) => {
    try {
        const plans = await prisma.plan.findMany({});
        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        console.error("Get Plans Error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const buyPlan = async (req: Request, res: Response) => {
    try {
        const { fullName, email, phone, amount, planId } = req.body;

        if (!fullName || !email || !phone || !amount || !planId) {
            return res.status(400).json({ success: false, message: "Missing required fields." });
        }

        // ✅ Find plan
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

        const planPrice = new Decimal(plan.price);
        const providedAmount = new Decimal(amount);

        if (!planPrice.equals(providedAmount)) {
            return res.status(400).json({ success: false, message: "Amount mismatch with plan price." });
        }

        // ✅ Find or create user
        let user = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    fullName,
                    email,
                    phone,
                    isActive: true,
                    role: "USER",
                },
            });
        }

        const amountInPaise = providedAmount.mul(100).toNumber();
        const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();

        // ✅ Create payment record
        const payment = await prisma.payment.create({
            data: {
                userId: user.id,
                planId: plan.id,
                transactionId: referenceId,
                paymentMethod: "PHONEPEPG",
                amount: providedAmount,
                purpose: `Purchase of plan: ${plan.name}`,
                status: PaymentStatus.PENDING,
            },
        });

        // ✅ PhonePe redirect URL
        const redirectUrl =
            process.env.NODE_ENV === "development"
                ? `http://localhost:3000/payment/response?transactionReference=${referenceId}`
                : `https://legaldhara.in/payment/response?transactionReference=${referenceId}`;

        // ✅ Initiate PhonePe payment
        const phonepeResponse = await Phonepe.initiatePayment(amountInPaise, referenceId, redirectUrl, {
            udf1: 'PLAN',
            udf2: referenceId,
            udf3: user.id,
            udf4: plan.id,
        });

        if (!phonepeResponse) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.FAILED },
            });
            return res.status(400).json({ success: false, message: "Failed to initiate transaction" });
        }

        return res.status(200).json({
            success: true,
            message: "Payment initiated successfully.",
            redirectUrl: phonepeResponse.redirectUrl,
            transactionId: referenceId,
        });
    } catch (error) {
        console.error("Buy Plan Error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
};

export const buyPlanByRazorpay = async (req: Request, res: Response) => {
    try {
        const { fullName, email, phone, amount, planId } = req.body;

        if (!fullName || !email || !phone || !amount || !planId) {
            return res.status(400).json({ success: false, message: "Missing required fields." });
        }

        // ✅ Find plan
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

        const planPrice = new Decimal(plan.price);
        const providedAmount = new Decimal(amount);

        if (!planPrice.equals(providedAmount)) {
            return res.status(400).json({ success: false, message: "Amount mismatch with plan price." });
        }

        // ✅ Find or create user
        let user = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    fullName,
                    email,
                    phone,
                    isActive: true,
                    role: "USER",
                },
            });
        }

        const amountInPaise = providedAmount.mul(100).toNumber();
        const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();

        // ✅ Create payment record
        const payment = await prisma.payment.create({
            data: {
                userId: user.id,
                planId: plan.id,
                transactionId: referenceId,
                paymentMethod: "PHONEPEPG",
                amount: providedAmount,
                purpose: `Purchase of plan: ${plan.name}`,
                status: PaymentStatus.PENDING,
            },
        });

        // ✅ Create Razorpay order
        const razorOrder = await Razorpay.createOrder(
            amountInPaise,
            "INR",
            referenceId,
            { udf1: 'PLAN', udf2: referenceId, udf3: user.id, udf4: plan.id }
        );

        if (!razorOrder) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: { status: PaymentStatus.FAILED },
            });
            return res
                .status(400)
                .json({ success: false, message: "Failed to initiate transaction" });
        }

        return res.status(200).json({
            success: true,
            message: "Razorpay order created successfully.",
            order: razorOrder,
            keyId: process.env.RAZORPAY_KEY_ID,
            amount: amountInPaise,
            currency: "INR",
            planName: plan.name,
        });
    } catch (error) {
        console.error("Buy Plan Error:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
};


// export const phonepeCallbackForPlan = async (req: Request, res: Response) => {
//     try {
//         const { authorization } = req.headers;
//         const rawBody = (req as any).rawBody;

//         if (!authorization || !rawBody) {
//             return res.status(400).json({ error: "Missing authorization or rawBody" });
//         }

//         // ✅ Validate callback
//         const callback = await Phonepe.validateCallback(authorization as string, rawBody);
//         const { orderId, paymentDetails, state, metaInfo, amount } = callback.payload;
//         const payment = paymentDetails?.[0];

//         if (!payment) return res.status(400).json({ error: "Invalid payment payload" });

//         // ✅ Extract metadata from callback
//         const userId = metaInfo?.udf1; // application ticket
//         const planId = metaInfo?.udf2; // old transactionId reference (if any)
//         const referenceId = metaInfo?.udf3; // old transactionId reference (if any)

//         if (!userId || !referenceId || !planId) {
//             logger.error("PhonePe Callback: Missing metaInfo", { metaInfo });
//             return res.status(400).json({ error: "Missing metaInfo" });
//         }

//         // ✅ Find the matching pending payment
//         const existingPayment = await prisma.payment.findUnique({
//             where: { transactionId: referenceId },
//         });

//         if (!existingPayment) {
//             logger.warn("Payment not found for callback", { referenceId });
//             return res.status(404).json({ error: "Payment not found for completion" });
//         }

//         // ✅ Determine status
//         const paymentStatus =
//             state === "COMPLETED" ? "SUCCESS" : "FAILED";


//         // ✅ Run transactional updates
//         await prisma.$transaction(async (tx) => {
//             // Update payment info
//             const updatePayment = await tx.payment.update({
//                 where: { id: existingPayment.id },
//                 data: {
//                     transactionId: orderId,
//                     paymentMethod: payment.paymentMode || "PHONEPEPG",
//                     amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
//                     status: paymentStatus,
//                     paymentGatewayResponse: callback.payload as unknown as Prisma.InputJsonValue,

//                     // paymentGatewayResponse: callback.payload as Prisma.InputJsonValue,
//                 },
//             });

//             if (paymentStatus === "SUCCESS") {
//                 const plan = await tx.plan.findUnique({ where: { id: planId } });
//                 if (!plan) throw new Error("Plan not found");

//                 // Create or update user plan subscription
//                 const existing = await tx.userPlan.findFirst({
//                     where: { userId, planId },
//                 });

//                 if (existing) {
//                     await tx.userPlan.update({
//                         where: { id: existing.id },
//                         data: {
//                             isActive: true,
//                             startDate: new Date(),
//                             endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
//                         },
//                     });
//                 } else {
//                     await tx.userPlan.create({
//                         data: {
//                             userId,
//                             planId,
//                             startDate: new Date(),
//                             endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
//                             isActive: true,
//                         },
//                     });
//                 }
//             }
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Callback processed successfully",
//         });
//     } catch (error: any) {
//         logger.error("PhonePe callback error", { error });
//         return res.status(500).json({ error: error.message || "Internal Server Error" });
//     }
// };



