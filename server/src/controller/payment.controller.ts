import { Request, Response } from "express";
import { prisma } from "../config/db";
import { AuthRequest } from "../types/custom";
import PhonePe from "../services/PhonePe";
import { logger } from "../utils/logger";
import {
  handleApplicationPaymentCallbackPhonePe,
  handleCertificatePaymentCallbackPhonePe,
  handlePlanPaymentCallbackPhonePe,
  handleCertificatePaymentCallbackRazorpay,
  handleApplicationPaymentCallbackRazorpay,
  handlePlanPaymentCallbackRazorpay
} from "../utils/callbacks";
import { CallbackData } from "pg-sdk-node";
import Razorpay from "../services/Razorpay";

const isProduction = process.env.NODE_ENV === "production";

export const getAllPayments = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string)?.trim() || "";

    // ✅ Include only specific payment statuses
    const allowedStatuses = ["SUCCESS", "FAILED", "PENDING"];

    // 🔍 Build where condition dynamically
    const where: any = {
      status: { in: allowedStatuses },
    };

    if (search) {
      where.OR = [
        { purpose: { contains: search, mode: "insensitive" } },
        { paymentMethod: { contains: search, mode: "insensitive" } },
        { application: { ticketNo: { contains: search, mode: "insensitive" } } },
        { application: { user: { fullName: { contains: search, mode: "insensitive" } } } },
        { application: { user: { email: { contains: search, mode: "insensitive" } } } },
        { service: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [payments, totalCount] = await Promise.all([
      prisma.payment.findMany({
        skip,
        take: limit,
        where,
        orderBy: { paymentDate: "desc" },
        select: {
          amount: true,
          paymentMethod: true,
          paymentType: true,
          purpose: true,
          transactionId: true,
          status: true,
          paymentDate: true,
          application: {
            select: {
              ticketNo: true,
            },
          },
          service: {
            select: { name: true },
          },
          certificateRequest: {
            select: {
              requestNo: true,
              subject: true
            },
          },
          plan: {
            select: {
              name: true,
            },
          },
          user: {
            select: {
              fullName: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    // 🔠 Convert status to uppercase
    const formattedPayments = payments.map((p) => ({
      ...p,
      status: p.status?.toUpperCase() || "",
    }));

    return res.status(200).json({
      success: true,
      pagination: {
        limit,
        page,
        totalPages: Math.ceil(totalCount / limit),
        totalRecords: totalCount,
      },
      payments: formattedPayments,
    });
  } catch (err: any) {
    console.error("Get All Payments Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};


export const getPaymentById = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const user = (req as AuthRequest).auth;
  const paymentId = req.params.id;

  if (!user || !user.id) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated",
    });
  }

  if (!paymentId) {
    return res.status(400).json({
      success: false,
      message: "Payment ID is required in the URL",
    });
  }

  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        application: {
          select: {
            id: true,
            ticketNo: true,
            userId: true,
            service: { select: { name: true } },
          },
        },
        service: {
          select: {
            id: true,
            name: true,
          },
        },
        parentTransaction: {
          select: {
            id: true,
            transactionId: true,
            amount: true,
          },
        },
        refunds: {
          select: {
            id: true,
            transactionId: true,
            amount: true,
            status: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (err: any) {
    console.error("Get Payment Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};


export const getUserPayments = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const user = (req as AuthRequest).auth;

  if (!user || !user.id) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated",
    });
  }

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [payments, totalCount] = await Promise.all([
      prisma.payment.findMany({
        where: {
          application: {
            userId: user.id,
          },
        },
        skip,
        take: limit,
        orderBy: { paymentDate: "desc" },
        include: {
          application: {
            select: {
              ticketNo: true,
              service: { select: { name: true } },
            },
          },
          service: { select: { name: true } },
        },
      }),
      prisma.payment.count({
        where: {
          application: {
            userId: user.id,
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalRecords: totalCount,
      payments,
    });
  } catch (err: any) {
    console.error("Get User Payments Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};



export const phonepeUnifiedCallback = async (req: Request, res: Response) => {
  try {
    const { authorization } = req.headers;
    const rawBody = (req as any).rawBody;

    if (!authorization || !rawBody) {
      return res.status(400).json({ error: "Missing authorization or rawBody" });
    }

    // ✅ Validate callback
    const callback = await PhonePe.validateCallback(authorization as string, rawBody);
    const { state, metaInfo } = callback.payload;

    if (!state || !metaInfo) return res.status(400).json({ success: false, message: "Invalid payment payload" });

    // ✅ Extract metadata from callback
    const type = metaInfo?.udf1; // payment type
    const referenceId = metaInfo?.udf2; // old transactionId reference (if any)

    if (!type) {
      logger.error("PhonePe Callback: Missing payment type in metaInfo", { metaInfo });
      return res.status(400).json({ success: false, message: "Missing payment type" });
    }

    logger.info(`📩 PhonePe callback received: ${type}`, { state, referenceId });

    // ✅ Find Payment
    const existingPayment = await prisma.payment.findFirst({
      where: { transactionId: referenceId },
    });

    if (!existingPayment) {
      logger.error("PhonePe Callback: Payment not found", { referenceId });
      return res.status(404).json({ success: false, message: "Payment not found" });
    }


    switch (type.toUpperCase()) {
      case "APPLICATION":
        await handleApplicationPaymentCallbackPhonePe(
          callback.payload as CallbackData,
          existingPayment);
        break;

      case "CERTIFICATE":
        await handleCertificatePaymentCallbackPhonePe(
          callback.payload as CallbackData,
          existingPayment
        );
        break;

      case "PLAN":
        await handlePlanPaymentCallbackPhonePe(
          callback.payload as CallbackData,
          existingPayment
        );
        break;

      default:
        logger.warn("Unknown payment type in callback", { type });
        return res.status(400).json({
          success: false,
          message: `Unknown payment type: ${type}`,
        });
    }

    return res.status(200).json({
      success: true,
      message: "Callback processed successfully",
    });
  } catch (error: any) {
    logger.error("PhonePe callback error", { error });
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};


export const handleRazorpayWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    const bodyString = JSON.stringify(req.body);

    const isValid = Razorpay.validateWebhook(signature, bodyString);

    if (!isValid) {
      console.warn("⚠️ Invalid Razorpay webhook signature");
      return res.status(400).json({ success: false });
    }

    const event = req.body.event;
    const paymentEntity = req.body.payload?.payment?.entity;

    if (!paymentEntity) return res.status(400).json({ success: false });

    const { status, notes } = paymentEntity;


    if (!notes || !status) {
      console.warn("⚠️ Razorpay webhook missing notes or status");
      return res.status(400).json({ success: false });
    }


    const type = notes?.udf1; // payment type
    const referenceId = notes?.udf2; // old transactionId reference (if any)

    if (!type) {
      logger.error("PhonePe Callback: Missing payment type in notes", { notes });
      return res.status(400).json({ success: false, message: "Missing payment type" });
    }

    logger.info(`📩 PhonePe callback received: ${type}`, { status, referenceId });

    // ✅ Find Payment
    const existingPayment = await prisma.payment.findFirst({
      where: { transactionId: referenceId },
    });

    if (!existingPayment) {
      logger.error("PhonePe Callback: Payment not found", { referenceId });
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    switch (type.toUpperCase()) {
      case "APPLICATION":
        await handleApplicationPaymentCallbackRazorpay(
          paymentEntity,
          existingPayment);
        break;

      case "CERTIFICATE":
        await handleCertificatePaymentCallbackRazorpay(
          paymentEntity,
          existingPayment
        );
        break;

      case "PLAN":
        await handlePlanPaymentCallbackRazorpay(
          paymentEntity,
          existingPayment
        );
        break;

      default:
        logger.warn("Unknown payment type in callback", { type });
        return res.status(400).json({
          success: false,
          message: `Unknown payment type: ${type}`,
        });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Razorpay Webhook Error:", error);
    return res.status(500).json({ success: false });
  }
};




// -- Response API's --

// Response API to fetch PhonePe payment status
export const phonepePaymentGatewayResponse = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { paymentReference } = req.params;

    if (!paymentReference || typeof paymentReference !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing payment reference',
      });
    }

    const paymentResponse = await PhonePe.checkOrderStatus(paymentReference);
    if (!paymentResponse || !paymentResponse.state) {
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch transaction status from payment gateway',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment response fetched successfully',
      phonpeResponse: paymentResponse,
    });
  } catch (error) {
    logger.error('Error in phonepePaymentGatewayResponse:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Razorpay Payment Verification and Redirect
export const verifyRazorpayPayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.redirect(
        `https://legaldhara.com/payment/response?status=failed&message=Missing+payment+details`
      );
    }

    const isValid = await Razorpay.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    // ⚙️ Dummy values to send in redirect (actual values will be updated via webhook)
    const transactionId = razorpay_order_id;
    const paymentMode = "Razorpay";
    const amount = req.body.amount || 0;
    const timestamp = new Date().toISOString();

    if (isValid) {
      // ✅ redirect to success page with info
      return res.redirect(
        `https://legaldhara.com/payment/response?status=success&transactionId=${transactionId}&paymentId=${razorpay_payment_id}&paymentMode=${paymentMode}&amount=${amount}&time=${timestamp}`
      );
    } else {
      // ❌ redirect to failed page
      return res.redirect(
        `https://legaldhara.com/payment/response?status=failed&transactionId=${transactionId}&paymentMode=${paymentMode}&amount=${amount}&time=${timestamp}`
      );
    }
  } catch (error) {
    console.error("verifyPayment error:", error);
    return res.redirect(
      `https://legaldhara.com/payment/response?status=failed&message=Server+Error`
    );
  }
};
