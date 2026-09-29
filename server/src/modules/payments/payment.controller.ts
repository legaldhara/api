import { PaymentAttemptStatus, Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { prisma } from "../../config/db";
import { AuthRequest } from "../../types/custom";
import { createOrReuseAttempt } from "./attemptService";
import { getOwnedCharge, PaymentDomainError } from "./chargeService";
import { razorpayGateway } from "./razorpayGateway";
import { reconcileAttempt } from "./reconciliationService";
import { requestFullRefund } from "./refundService";
import { settleProviderPayment } from "./settlementService";

const actor = (request: Request) => {
  const auth = (request as AuthRequest).auth;
  return { id: auth.id, role: auth.role };
};

export const createAttempt = async (request: Request, response: Response): Promise<void> => {
  const result = await createOrReuseAttempt({ chargeId: request.params.chargeId, actor: actor(request) });
  response.status(200).json({ success: true, data: result });
};

export const confirmAttempt = async (request: Request, response: Response): Promise<void> => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.body ?? {};
  if (![orderId, paymentId, signature].every((value) => typeof value === "string" && value.length > 0)) {
    throw new PaymentDomainError("Razorpay confirmation fields are required", 400, "INVALID_CONFIRMATION");
  }
  if (!razorpayGateway.verifyPaymentSignature(orderId, paymentId, signature)) {
    throw new PaymentDomainError("Payment signature is invalid", 400, "INVALID_SIGNATURE");
  }
  const attempt = await prisma.paymentAttempt.findUnique({ where: { gatewayOrderId: orderId }, include: { charge: true } });
  if (!attempt || (actor(request).role === "USER" && attempt.charge.userId !== actor(request).id)) {
    throw new PaymentDomainError("Payment attempt not found", 404, "ATTEMPT_NOT_FOUND");
  }
  const payment = await razorpayGateway.fetchPayment(paymentId);
  if (payment.status !== "captured") {
    response.status(202).json({ success: true, data: { status: "PROCESSING", chargeId: attempt.chargeId } });
    return;
  }
  await settleProviderPayment({
    attemptId: attempt.id,
    gatewayOrderId: payment.orderId,
    gatewayPaymentId: payment.id,
    amountMinor: payment.amount,
    currency: payment.currency,
    providerStatus: "captured",
    paymentMethod: payment.method,
    gatewayResponse: payment,
  });
  response.status(200).json({ success: true, data: { status: "PAID", chargeId: attempt.chargeId } });
};

const publicChargeStatus = (chargeStatus: string, attemptStatus?: string) => {
  if (chargeStatus === "PAID") return "PAID";
  if (chargeStatus === "REFUNDED") return "REFUNDED";
  if (chargeStatus === "CANCELLED") return "CANCELLED";
  if (["CREATING", "PENDING", "AUTHORIZED"].includes(attemptStatus ?? "")) return "PROCESSING";
  if (["FAILED", "EXPIRED"].includes(attemptStatus ?? "")) return "FAILED_RETRYABLE";
  return "OPEN";
};

export const getChargeStatus = async (request: Request, response: Response): Promise<void> => {
  const charge = await getOwnedCharge({ chargeId: request.params.chargeId, actor: actor(request) });
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { chargeId: charge.id },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  response.status(200).json({
    success: true,
    data: {
      chargeId: charge.id,
      status: publicChargeStatus(charge.status, attempt?.status),
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      purpose: charge.purpose,
    },
  });
};

export const getCharge = async (request: Request, response: Response): Promise<void> => {
  const charge = await getOwnedCharge({ chargeId: request.params.chargeId, actor: actor(request) });
  const attempts = await prisma.paymentAttempt.findMany({
    where: { chargeId: charge.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, gatewayOrderId: true, gatewayPaymentId: true,
      paymentMethod: true, failureCode: true, failureDescription: true,
      expiresAt: true, settledAt: true, createdAt: true,
      refund: { select: { status: true, gatewayRefundId: true, requestedAt: true, processedAt: true, reason: true } },
    },
  });
  response.status(200).json({ success: true, data: { ...charge, attempts } });
};

export const listMine = async (request: Request, response: Response): Promise<void> => {
  const auth = (request as AuthRequest).auth;
  const charges = await prisma.paymentCharge.findMany({
    where: { userId: auth.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, targetType: true, category: true, amountMinor: true, currency: true,
      purpose: true, status: true, paidAt: true, refundedAt: true, createdAt: true,
    },
  });
  response.status(200).json({ success: true, data: charges });
};

export const listAdmin = async (request: Request, response: Response): Promise<void> => {
  const page = Math.max(Number(request.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 100);
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const requestedStatus = typeof request.query.status === "string" ? request.query.status : "";
  const status = Object.values(PaymentAttemptStatus).includes(requestedStatus as PaymentAttemptStatus)
    ? requestedStatus as PaymentAttemptStatus
    : undefined;
  const searchableCharge: Prisma.PaymentChargeWhereInput = search ? {
    OR: [
      { purpose: { contains: search, mode: "insensitive" } },
      { user: { is: { OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ] } } },
      { application: { is: { ticketNo: { contains: search, mode: "insensitive" } } } },
      { certificateRequest: { is: { requestNo: { contains: search, mode: "insensitive" } } } },
      { plan: { is: { name: { contains: search, mode: "insensitive" } } } },
    ],
  } : {};
  const where: Prisma.PaymentAttemptWhereInput = {
    ...(status ? { status } : {}),
    ...(search ? {
      OR: [
        { gatewayOrderId: { contains: search, mode: "insensitive" } },
        { gatewayPaymentId: { contains: search, mode: "insensitive" } },
        { charge: { is: searchableCharge } },
      ],
    } : {}),
  };

  const [attempts, totalRecords] = await Promise.all([
    prisma.paymentAttempt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, status: true, amountMinor: true, currency: true, gatewayOrderId: true,
        gatewayPaymentId: true, failureCode: true, failureDescription: true, createdAt: true, settledAt: true,
        charge: { select: {
          id: true, userId: true, targetType: true, category: true, purpose: true, status: true,
          user: { select: { fullName: true, email: true, phone: true } },
          application: { select: { ticketNo: true } },
          certificateRequest: { select: { requestNo: true } },
          plan: { select: { name: true } },
        } },
        refund: { select: { status: true, gatewayRefundId: true, requestedAt: true, processedAt: true } },
      },
    }),
    prisma.paymentAttempt.count({ where }),
  ]);
  response.status(200).json({
    success: true,
    data: attempts,
    pagination: { page, limit, totalRecords, totalPages: Math.ceil(totalRecords / limit) },
  });
};

export const getAdminAttempt = async (request: Request, response: Response): Promise<void> => {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { id: request.params.attemptId },
    select: {
      id: true, status: true, amountMinor: true, currency: true, gatewayOrderId: true,
      gatewayPaymentId: true, paymentMethod: true, failureCode: true, failureDescription: true,
      expiresAt: true, settledAt: true, createdAt: true, updatedAt: true,
      charge: true,
      refund: { select: { status: true, gatewayRefundId: true, reason: true, requestedAt: true, processedAt: true } },
    },
  });
  if (!attempt) throw new PaymentDomainError("Payment attempt not found", 404, "ATTEMPT_NOT_FOUND");
  response.status(200).json({ success: true, data: attempt });
};

export const reconcileAdminAttempt = async (request: Request, response: Response): Promise<void> => {
  const result = await reconcileAttempt(request.params.attemptId);
  response.status(200).json({ success: true, data: { result } });
};

export const refundAdminAttempt = async (request: Request, response: Response): Promise<void> => {
  const auth = (request as AuthRequest).auth;
  const result = await requestFullRefund({
    attemptId: request.params.attemptId,
    actorId: auth.id,
    reason: request.body?.reason ?? "",
  });
  response.status(202).json({ success: true, data: result });
};

export const paymentErrorHandler = (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
  if (error instanceof PaymentDomainError) {
    response.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
    return;
  }
  next(error);
};

export const paymentController = {
  createAttempt,
  confirmAttempt,
  getChargeStatus,
  getCharge,
  listMine,
  listAdmin,
  getAdminAttempt,
  reconcileAttempt: reconcileAdminAttempt,
  refundAttempt: refundAdminAttempt,
};
