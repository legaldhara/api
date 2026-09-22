import { ApplicationStatus, CertificateRequestStatus, Payment, PaymentStatus, Prisma } from "@prisma/client";
import { CallbackData } from "pg-sdk-node";
import { prisma } from "../config/db";
import { Decimal } from "@prisma/client/runtime/library";
import { getPaymentStatusEmail, getPaymentStatusEmailForCertificate } from "./email";
import MailService from '../services/Mail'
import Notification from "../services/Notification";
import { logger } from "./logger";
import { io } from "..";

const isProduction = process.env.NODE_ENV === 'production';

export const handleApplicationPaymentCallbackPhonePe = async (payload: CallbackData, payment: Payment): Promise<void> => {

    const { orderId, paymentDetails, state, metaInfo, amount } = payload;
    const paymentData = paymentDetails?.[0];

    if (!paymentData) {
        throw new Error('Invalid payment payload');
    }

    const ticketNo = metaInfo?.udf3


    if (!ticketNo) {
        throw new Error("Missing application ticket No.");
    }

    const application = await prisma.application.findUnique({
        where: { ticketNo },
    });

    if (!application) {
        throw new Error("Application not found");
    }

    let paymentStatus: PaymentStatus =
        state === "COMPLETED"
            ? PaymentStatus.SUCCESS
            : state === "FAILED"
                ? PaymentStatus.FAILED
                : PaymentStatus.PENDING;

    // ✅ Decide next status based on workflow
    const newStatus =
        paymentStatus === "SUCCESS"
            ? ApplicationStatus.UNDER_REVIEW
            : application.applicationStatus;

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: orderId,
                paymentMethod: paymentData.paymentMode || "UNKNOWN",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        // Create application update log
        await tx.applicationUpdate.create({
            data: {
                applicationId: application.id,
                updaterBy: application.userId, // ✅ Correctly logs user who owns application
                message:
                    state === "COMPLETED"
                        ? "Payment Successful, Application is under review."
                        : "Payment failed. Please retry.",
                paymentId: orderId,
                prevStatus: application.applicationStatus,
                newStatus,
                type: updatePayment.paymentType,
                updateCharges: state === "COMPLETED" ? new Decimal(0) : new Decimal(amount).dividedBy(100),
                UpdateType:
                    state === "COMPLETED"
                        ? "PAYMENT_SUCCESS"
                        : "PAYMENT_FAILED",
                pendingPayment: false,
            },
        });

        // Update application status
        await tx.application.update({
            where: { id: application.id },
            data: {
                applicationStatus: newStatus,
            },
        });
    });

    // ✅ After transaction completes successfully
    const user = await prisma.user.findUnique({
        where: { id: application.userId },
    });

    if (isProduction && user?.email) {
        const emailContent = getPaymentStatusEmail({
            fullName: user.fullName || "User",
            paymentStatus,
            ticketNo,
            amount: new Decimal(amount).dividedBy(100).toNumber(),
            applicationStatus: newStatus,
        });

        await MailService.send(
            user.email,
            emailContent.subject,
            emailContent.text,
            "info",
            emailContent.html
        ).catch((err: any) => logger.error("Email send failed", { err }));
    }

    
    // 🔔 Save notification in DB for admin panel
    await Notification.createAdminNotification({
        title: `New Payment Received: ${application.ticketNo}`,
        body: `New payment received of Rs. ${new Decimal(amount).dividedBy(100)} by ${user?.fullName || "User"}`,
        notificationType: "application",
        role: "ADMIN",
        audienceType: "SPECIFIC",
        clickAction: `/applications`, // where admin should click
    });
    
    // 🔴 Emit live socket event (your existing code)
    io.to("ADMINS").emit("new-notification", {
        trackingId: application.ticketNo,
        message:
        `New payment received of Rs. ${new Decimal(amount).dividedBy(100)} by ${user?.fullName || "User"}.`,
        status: newStatus,
        createdAt: new Date(),
        clickAction: `/applications`,
    });
    

};


export const handleCertificatePaymentCallbackPhonePe = async (payload: CallbackData, payment: Payment): Promise<void> => {

    const { orderId, paymentDetails, state, metaInfo, amount } = payload;
    const paymentData = paymentDetails?.[0];

    if (!paymentData) {
        throw new Error('Invalid payment payload');
    }

    const requestNo = metaInfo?.udf3

    if (!requestNo) {
        throw new Error("Missing certificate request No.");
    }

    const certificate = await prisma.certificateRequest.findUnique({
        where: { requestNo },
    });

    if (!certificate) {
        throw new Error("Certificate not found");
    }

    let paymentStatus: PaymentStatus =
        state === "COMPLETED"
            ? PaymentStatus.SUCCESS
            : state === "FAILED"
                ? PaymentStatus.FAILED
                : PaymentStatus.PENDING;

    // ✅ Decide next status based on workflow
    const newStatus =
        paymentStatus === "SUCCESS"
            ? CertificateRequestStatus.UNDER_REVIEW
            : certificate.status;

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: orderId,
                paymentMethod: paymentData.paymentMode || "UNKNOWN",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        // Create application update log
        await tx.certificateUpdate.create({
            data: {
                certificateRequestId: certificate.id,
                updatedBy: certificate.userId, // ✅ Correctly logs user who owns application
                message:
                    state === "COMPLETED"
                        ? "Payment Successful, Processing is under review."
                        : "Payment failed. Please retry.",
                transactionId: orderId,
                prevStatus: certificate.status,
                newStatus,
                chargesRequired: state === "COMPLETED" ? new Decimal(0) : new Decimal(amount).dividedBy(100),
                updateType:
                    state === "COMPLETED"
                        ? "PAYMENT_SUCCESS"
                        : "PAYMENT_FAILED",
            },
        });

        // Update application status
        await tx.certificateRequest.update({
            where: { id: certificate.id },
            data: {
                status: newStatus,
                pendingPayment: paymentStatus === "FAILED" ? true : false,
            },
        });
    });

    // ✅ After transaction completes successfully
    const user = await prisma.user.findUnique({
        where: { id: certificate.userId },
    });

    if (process.env.NODE_ENV === "production" && user?.email) {
        const emailContent = getPaymentStatusEmailForCertificate({
            fullName: user.fullName || "User",
            paymentStatus,
            requestNo,
            amount: new Decimal(amount).dividedBy(100).toNumber(),
            status: newStatus,
        });

        await MailService.send(
            user.email,
            emailContent.subject,
            emailContent.text,
            "info",
            emailContent.html
        ).catch((err: any) => logger.error("Email send failed", { err }));
    }
};


export const handlePlanPaymentCallbackPhonePe = async (payload: CallbackData, payment: Payment): Promise<void> => {

    const { orderId, paymentDetails, state, metaInfo, amount } = payload;
    const paymentData = paymentDetails?.[0];

    if (!paymentData) {
        throw new Error('Invalid payment payload');
    }

    const userId = metaInfo?.udf3
    const planId = metaInfo?.udf4


    if (!userId || !planId) {
        throw new Error("Missing user ID or plan ID.");
    }

    let paymentStatus: PaymentStatus =
        state === "COMPLETED"
            ? PaymentStatus.SUCCESS
            : state === "FAILED"
                ? PaymentStatus.FAILED
                : PaymentStatus.PENDING;

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: orderId,
                paymentMethod: paymentData.paymentMode || "PHONEPEPG",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        if (paymentStatus === "SUCCESS") {
            const plan = await tx.plan.findUnique({ where: { id: planId } });
            if (!plan) throw new Error("Plan not found");

            // Create or update user plan subscription
            const existing = await tx.userPlan.findFirst({
                where: { userId, planId },
            });

            if (existing) {
                await tx.userPlan.update({
                    where: { id: existing.id },
                    data: {
                        isActive: true,
                        startDate: new Date(),
                        endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
                    },
                });
            } else {
                await tx.userPlan.create({
                    data: {
                        userId,
                        planId,
                        startDate: new Date(),
                        endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
                        isActive: true,
                    },
                });
            }
        }
    });
};

// ✅ Handle application payment callback Razorpay
export const handleApplicationPaymentCallbackRazorpay = async (payload: any, payment: Payment): Promise<void> => {

    if (!payload) {
        throw new Error('Invalid payment payload');
    }

    const { order_id, method, status, notes, amount } = payload;
    const ticketNo = notes?.udf3

    if (!ticketNo) {
        throw new Error("Missing application ticket No.");
    }

    const application = await prisma.application.findUnique({
        where: { ticketNo },
    });

    if (!application) {
        throw new Error("Application not found");
    }

    let paymentStatus: PaymentStatus | null = null;
    if (status === "captured") paymentStatus = PaymentStatus.SUCCESS;
    else if (status === "failed") paymentStatus = PaymentStatus.FAILED;
    else if (status === "authorized") paymentStatus = PaymentStatus.PENDING;

    if (!paymentStatus) throw new Error("Unknown payment status from Razorpay");

    // ✅ Decide next status based on workflow
    const newStatus =
        paymentStatus === "SUCCESS"
            ? ApplicationStatus.UNDER_REVIEW
            : application.applicationStatus;

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: order_id,
                paymentMethod: method || "UNKNOWN",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        // Create application update log
        await tx.applicationUpdate.create({
            data: {
                applicationId: application.id,
                updaterBy: application.userId, // ✅ Correctly logs user who owns application
                message:
                    status === "captured"
                        ? "Payment Successful, Application is under review."
                        : "Payment failed. Please retry.",
                paymentId: order_id,
                prevStatus: application.applicationStatus,
                newStatus,
                type: updatePayment.paymentType,
                updateCharges: status === "captured" ? new Decimal(0) : new Decimal(amount).dividedBy(100),
                UpdateType:
                    status === "captured"
                        ? "PAYMENT_SUCCESS"
                        : "PAYMENT_FAILED",
                pendingPayment: false,
            },
        });

        // Update application status
        await tx.application.update({
            where: { id: application.id },
            data: {
                applicationStatus: newStatus,
            },
        });
    });

    // ✅ After transaction completes successfully
    const user = await prisma.user.findUnique({
        where: { id: application.userId },
    });

    if (isProduction && user?.email) {
        const emailContent = getPaymentStatusEmail({
            fullName: user.fullName || "User",
            paymentStatus,
            ticketNo,
            amount: new Decimal(amount).dividedBy(100).toNumber(),
            applicationStatus: newStatus,
        });

        await MailService.send(
            user.email,
            emailContent.subject,
            emailContent.text,
            "info",
            emailContent.html
        ).catch((err: any) => logger.error("Email send failed", { err }));
    }

};


export const handleCertificatePaymentCallbackRazorpay = async (payload: any, payment: Payment): Promise<void> => {

    if (!payload) {
        throw new Error('Invalid payment payload');
    }

    const { order_id, method, status, notes, amount } = payload;


    const requestNo = notes?.udf3

    if (!requestNo) {
        throw new Error("Missing certificate request No.");
    }

    const certificate = await prisma.certificateRequest.findUnique({
        where: { requestNo },
    });

    if (!certificate) {
        throw new Error("Certificate not found");
    }

    let paymentStatus: PaymentStatus | null = null;
    if (status === "captured") paymentStatus = PaymentStatus.SUCCESS;
    else if (status === "failed") paymentStatus = PaymentStatus.FAILED;
    else if (status === "authorized") paymentStatus = PaymentStatus.PENDING;

    if (!paymentStatus) throw new Error("Unknown payment status from Razorpay");


    // ✅ Decide next status based on workflow
    const newStatus =
        paymentStatus === "SUCCESS"
            ? CertificateRequestStatus.UNDER_REVIEW
            : certificate.status;

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: order_id,
                paymentMethod: method || "UNKNOWN",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        // Create application update log
        await tx.certificateUpdate.create({
            data: {
                certificateRequestId: certificate.id,
                updatedBy: certificate.userId, // ✅ Correctly logs user who owns application
                message:
                    status === "captured"
                        ? "Payment Successful, Processing is under review."
                        : "Payment failed. Please retry.",
                transactionId: order_id,
                prevStatus: certificate.status,
                newStatus,
                chargesRequired: status === "captured" ? new Decimal(0) : new Decimal(amount).dividedBy(100),
                updateType:
                    status === "captured"
                        ? "PAYMENT_SUCCESS"
                        : "PAYMENT_FAILED",
            },
        });

        // Update application status
        await tx.certificateRequest.update({
            where: { id: certificate.id },
            data: {
                status: newStatus,
                pendingPayment: paymentStatus === "FAILED" ? true : false,
            },
        });
    });

    // ✅ After transaction completes successfully
    const user = await prisma.user.findUnique({
        where: { id: certificate.userId },
    });

    if (process.env.NODE_ENV === "production" && user?.email) {
        const emailContent = getPaymentStatusEmailForCertificate({
            fullName: user.fullName || "User",
            paymentStatus,
            requestNo,
            amount: new Decimal(amount).dividedBy(100).toNumber(),
            status: newStatus,
        });

        await MailService.send(
            user.email,
            emailContent.subject,
            emailContent.text,
            "info",
            emailContent.html
        ).catch((err: any) => logger.error("Email send failed", { err }));
    }
};


export const handlePlanPaymentCallbackRazorpay = async (payload: any, payment: Payment): Promise<void> => {

    if (!payload) {
        throw new Error('Invalid payment payload');
    }
    const { order_id, method, status, notes, amount } = payload;

    if (!order_id || !method || !status || !amount) {
        throw new Error('Missing required payment fields');
    }

    const userId = notes?.udf3
    const planId = notes?.udf4


    if (!userId || !planId) {
        throw new Error("Missing user ID or plan ID.");
    }


    let paymentStatus: PaymentStatus | null = null;
    if (status === "captured") paymentStatus = PaymentStatus.SUCCESS;
    else if (status === "failed") paymentStatus = PaymentStatus.FAILED;
    else if (status === "authorized") paymentStatus = PaymentStatus.PENDING;

    if (!paymentStatus) throw new Error("Unknown payment status from Razorpay");

    // ✅ Run transactional updates
    await prisma.$transaction(async (tx) => {
        // Update payment info
        const updatePayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
                transactionId: order_id,
                paymentMethod: method || "PHONEPEPG",
                amount: new Decimal(amount).dividedBy(100), // assuming amount is in paise
                status: paymentStatus,
                paymentGatewayResponse: payload as unknown as Prisma.InputJsonValue,
            },
        });

        if (paymentStatus === "SUCCESS") {
            const plan = await tx.plan.findUnique({ where: { id: planId } });
            if (!plan) throw new Error("Plan not found");

            // Create or update user plan subscription
            const existing = await tx.userPlan.findFirst({
                where: { userId, planId },
            });

            if (existing) {
                await tx.userPlan.update({
                    where: { id: existing.id },
                    data: {
                        isActive: true,
                        startDate: new Date(),
                        endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
                    },
                });
            } else {
                await tx.userPlan.create({
                    data: {
                        userId,
                        planId,
                        startDate: new Date(),
                        endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
                        isActive: true,
                    },
                });
            }
        }
    });
};