import { Request, Response } from "express";
import { createCertificateRequestSchema } from "../zodSchema/certificate.schema";
import { prisma } from "../config/db";
import { AuthRequest } from "../types/custom";
import { formatToIndianNumber } from "../utils/lib";
import { CertificateRequestStatus, CertificateUpdateType, PaymentStatus, PaymentType, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import Phonepe from "../services/PhonePe";
import { initiateCertificatePaymentSchema } from "../zodSchema/payment.schema";
import { logger } from "../utils/logger";
import Razorpay from "../services/Razorpay";
import { generateTicketNumber } from "../utils/ticketGenerator";
import Notification from "../services/Notification";
import { io } from "..";

export const createCertificateRequest = async (req: Request, res: Response) => {
  try {
    const parsed = createCertificateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.format(),
      });
    }

    const { fullName, email, phone, subject, description } = parsed.data;

    // ✅ Check if user already exists
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone: formatToIndianNumber(phone) }],
      },
    });

    // ✅ If user not found → create
    if (!user) {
      user = await prisma.user.create({
        data: { fullName, email, phone: formatToIndianNumber(phone) },
      });
    }

    // ✅ Check existing requests for same subject
    const existingRequest = await prisma.certificateRequest.findFirst({
      where: {
        userId: user.id,
        subject: {
          equals: subject,
          mode: "insensitive",
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingRequest) {
      if (["PENDING", "UNDER_REVIEW", "APPROVED"].includes(existingRequest.status)) {
        return res.status(400).json({
          success: false,
          message: `You already have a ${existingRequest.subject} request that is currently ${existingRequest.status.toLowerCase()}. Please wait until it is completed or rejected.`,
        });
      }

      if (existingRequest.status === "COMPLETED") {
        return res.status(400).json({
          success: false,
          message:
            "Your previous certificate request has been completed. You can submit a new request only if the details or purpose are different.",
        });
      }
    }

    // ✅ Create new request
    const requestNo = generateTicketNumber("CER");

    const newRequest = await prisma.certificateRequest.create({
      data: {
        requestNo,
        userId: user.id,
        subject,
        description,
        status: CertificateRequestStatus.UNDER_REVIEW,
      },
    });

    // Create initial update record (handles payment info)
    await prisma.certificateUpdate.create({
      data: {
        certificateRequestId: newRequest.id,
        updatedBy: user.id,
        prevStatus: CertificateRequestStatus.PENDING,
        newStatus: CertificateRequestStatus.UNDER_REVIEW,
        message: `Application submitted. Under review.`,
        updateType: CertificateUpdateType.SYSTEM_GENERATED, // later can switch to SYSTEM_GENERATED
      },
    });

    await Notification.createAdminNotification({
      title: `New Certificate Request Received: #${newRequest.requestNo}`,
      body: `A new certificate request has been submitted by ${fullName}.`,
      notificationType: "certificate",
      role: "ADMIN",
      audienceType: "SPECIFIC",
      clickAction: `/certificates`, // where admin should click
    });

    // 🔴 Emit live socket event (your existing code)
    io.to("ADMINS").emit("new-notification", {
      trackingId: newRequest.requestNo,
      message: `New certificate request submitted by ${fullName}`,
      status: newRequest.isResolved ? "resolved" : "pending",
      createdAt: new Date(),
      clickAction: `/certificates`,
    });

    // ✅ Exclude internal IDs
    const { id, userId, ...safeData } = newRequest;

    return res.status(201).json({
      success: true,
      message: "Certificate request submitted successfully.",
      data: safeData,
    });
  } catch (error: any) {
    console.error("❌ Error creating certificate request:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


export const getAllCertificateRequests = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string)?.trim() || "";

    // ✅ Search conditions
    const where: any = search
      ? {
        OR: [
          { subject: { contains: search, mode: "insensitive" } },
          {
            status: {
              in: Object.values(CertificateRequestStatus).filter((st) =>
                st.toLowerCase().includes(search.toLowerCase())
              ),
            },
          },
          {
            user: {
              is: {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                  { phone: { contains: search, mode: "insensitive" } },
                ],
              }
            },
          },
        ],
      }
      : {};

    const [requests, totalCount] = await Promise.all([
      prisma.certificateRequest.findMany({
        skip,
        take: limit,
        where,
        include: {
          user: {
            select: { fullName: true, email: true, phone: true },
          },
          updates: {
            select: {
              chargesRequired: true,
              transactionId: true,
              attachmentUrl: true,
              attachmentPublicId: true,
              message: true,
              createdAt: true,
              updateType: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.certificateRequest.count({ where }),
    ]);

    const safeRequests = requests.map((req) => {
      const { id, userId, ...safeReq } = req;
      return safeReq;
    });

    return res.json({
      success: true,
      requests: safeRequests,
      pagination: {
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        page,
        limit,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


// ✅ Get user’s own requests (USER)
// ✅ Get user's own certificate requests with pagination
export const getUserCertificateRequests = async (req: Request, res: Response) => {
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

    const [requests, totalCount] = await Promise.all([
      prisma.certificateRequest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.certificateRequest.count({ where: { userId: user.id } }),
    ]);

    const safeRequests = requests.map(req => {
      const { id, userId, ...safeReq } = req;
      return safeReq;
    });

    return res.json({
      success: true,
      data: safeRequests,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


// ✅ Get Certificate Request by Request No (User or Admin)
export const getCertificateRequestByRequestNo = async (req: Request, res: Response) => {
  const { requestNo } = req.params;
  const user = (req as AuthRequest).auth;

  if (!user || !user.id) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not found in request context",
    });
  }

  try {
    const certificateRequest = await prisma.certificateRequest.findUnique({
      where: { requestNo },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
        updates: {
          orderBy: { createdAt: "desc" },
          select: {
            chargesRequired: true,
            message: true,
            transactionId: true,
            attachmentUrl: true,
            attachmentPublicId: true,
            updateType: true,
            createdAt: true,
            updater: {
              select: {
                fullName: true,
                role: true,
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: "desc" },
          select: {
            amount: true,
            status: true,
            purpose: true,
            paymentType: true,
            transactionId: true,
            paymentMethod: true,
            paymentDate: true,
          },
        },
      },
    });

    if (!certificateRequest) {
      return res.status(404).json({
        success: false,
        message: "Certificate request not found",
      });
    }

    // 🚫 Access control
    if (
      user.role !== "ADMIN" &&
      user.role !== "COADMIN" &&
      certificateRequest.userId !== user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not authorized to view this certificate request",
      });
    }

    // 💰 Compute payment summary
    const successfulPayments = certificateRequest.payments.filter(
      (p) => p.status === "SUCCESS"
    );
    const totalPaid = successfulPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const paymentCount = certificateRequest.payments.length;

    // 🕓 Get latest update
    const latestUpdate = certificateRequest.updates[0] || null;

    // ✅ Safe structured response
    const structuredResponse = {
      requestNo: certificateRequest.requestNo,
      subject: certificateRequest.subject,
      description: certificateRequest.description,
      status: certificateRequest.status,
      docRequired: certificateRequest.docRequired,
      pendingPayment: certificateRequest.pendingPayment,
      isResolved: certificateRequest.isResolved,
      createdAt: certificateRequest.createdAt,
      resolvedAt: certificateRequest.resolvedAt,

      totalPaid,
      paymentCount,
      latestUpdate,

      userDetails: certificateRequest.user,
      paymentHistory: certificateRequest.payments,
      updateHistory: certificateRequest.updates,
    };

    return res.status(200).json({
      success: true,
      message: "Certificate request fetched successfully",
      data: structuredResponse,
    });
  } catch (err: any) {
    console.error("Get Certificate Request Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};




export const updateCertificateWithRoleBasedRules = async (req: Request, res: Response) => {
  try {
    const actor = (req as AuthRequest).auth;
    const { requestNo } = req.params;
    const {
      status,
      message,
      attachmentUrl,
      attachmentPublicId,
      chargesRequired,
      docRequired,
      pendingPayment,
    } = req.body;

    if (!actor || !actor.id) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ✅ Fetch certificate with last update
    const certificate = await prisma.certificateRequest.findUnique({
      where: { requestNo },
      include: { updates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!certificate) {
      return res.status(404).json({ success: false, message: "Certificate not found." });
    }

    const isAdmin = ["ADMIN", "COADMIN"].includes(actor.role);
    const isUser = actor.role === "USER";

    if (isUser && certificate.userId !== actor.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // ❌ Block updates on final states
    if (["CLOSED", "COMPLETED"].includes(certificate.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${certificate.status.toLowerCase()} certificate request.`,
      });
    }

    const lastUpdate = certificate.updates?.[0];
    let newStatus: CertificateRequestStatus = certificate.status;
    let updateType: CertificateUpdateType = CertificateUpdateType.USER_MESSAGE;
    let finalMessage = message || "Update added successfully.";
    let currentCharge = lastUpdate?.chargesRequired ? new Decimal(lastUpdate.chargesRequired) : null;
    let isResolved = certificate.isResolved;
    let resolvedAt: Date | null = certificate.resolvedAt;
    let nextAction: string | null = null;

    // new flags
    let pendingDocs = certificate.docRequired;
    let pendingPay = certificate.pendingPayment;

    // ==========================================================
    // 🧑‍💼 ADMIN ACTIONS
    // ==========================================================
    if (isAdmin) {
      const validStatuses: CertificateRequestStatus[] = [
        CertificateRequestStatus.APPROVED,
        CertificateRequestStatus.REJECTED,
        CertificateRequestStatus.COMPLETED,
        CertificateRequestStatus.CLOSED,
      ];

      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Admin can only set: ${validStatuses.join(", ")}`,
        });
      }

      if (docRequired === true) {
        pendingDocs = true;
        updateType = CertificateUpdateType.STATUS_CHANGE;
        finalMessage = message || "Admin requested additional documents.";
        nextAction = "User must upload requested documents.";
        newStatus = CertificateRequestStatus.PENDING;
      } else if (docRequired === false) {
        pendingDocs = false;
      }

      if (chargesRequired) {
        pendingPay = true;
        currentCharge = new Decimal(chargesRequired);
        updateType = CertificateUpdateType.PAYMENT_REQUESTED;
        finalMessage =
          message || `Payment of ₹${chargesRequired} required for certificate processing.`;
        nextAction = "User must complete payment.";
        newStatus = CertificateRequestStatus.PAYMENT_REQUIRED;
      } else if (pendingPayment === false) {
        pendingPay = false;
      }

      if (status) {
        newStatus = status as CertificateRequestStatus;

        if (status === "APPROVED") {
          finalMessage = message || "Certificate request approved.";
          updateType = CertificateUpdateType.ADMIN_MESSAGE;
          nextAction = "Admin will upload the certificate.";
        } else if (status === "REJECTED") {
          finalMessage = message || "Certificate request rejected.";
          updateType = CertificateUpdateType.ADMIN_MESSAGE;
          nextAction = "User may reapply or contact support.";
          isResolved = true;
          resolvedAt = new Date();
        } else if (status === "COMPLETED") {
          if (!attachmentUrl || !attachmentPublicId) {
            return res.status(400).json({
              success: false,
              message: "Attachment URL and Public ID are required for completed status.",
            });
          }
          finalMessage = message || "Certificate uploaded successfully.";
          updateType = CertificateUpdateType.CERTIFICATE_PROVIDED;
          nextAction = "Certificate provided to user.";
          isResolved = true;
          resolvedAt = new Date();
        } else if (status === "CLOSED") {
          finalMessage = message || "Certificate request closed.";
          updateType = CertificateUpdateType.ADMIN_MESSAGE;
          nextAction = "No further actions allowed.";
          isResolved = true;
          resolvedAt = new Date();
        }
      }

      // Admin replying without status change
      if (!status && !chargesRequired && message) {
        updateType = CertificateUpdateType.ADMIN_MESSAGE;
        nextAction = "Awaiting user response.";
      }
    }

    // ==========================================================
    // 🙋 USER ACTIONS
    // ==========================================================
    if (isUser) {
      const allowedStatuses = [
        CertificateRequestStatus.PENDING,
        CertificateRequestStatus.REJECTED as CertificateRequestStatus
      ];
      if (!allowedStatuses.includes(certificate.status)) {
        return res.status(403).json({
          success: false,
          message: `You can only update while your request is in ${allowedStatuses.join(", ")} state.`,
        });
      }

      if (!message || !attachmentUrl && !attachmentPublicId) {
        return res.status(400).json({
          success: false,
          message: "Message or attachment is required.",
        });
      }

      if (status || chargesRequired) {
        return res.status(403).json({
          success: false,
          message: "Users cannot modify status or charges.",
        });
      }

      // ✅ System auto-handles UNDER_REVIEW when user responds
      newStatus = CertificateRequestStatus.UNDER_REVIEW;
      updateType = CertificateUpdateType.USER_MESSAGE;
      finalMessage = message || "User sent clarification or uploaded documents.";
      nextAction = "Awaiting admin review.";
      isResolved = false;
      resolvedAt = null;
      pendingDocs = false;
    }

    // ==========================================================
    // 🧩 TRANSACTION — Create Update + Update Certificate
    // ==========================================================
    await prisma.$transaction(async (tx) => {
      await tx.certificateUpdate.create({
        data: {
          certificateRequestId: certificate.id,
          updatedBy: actor.id,
          message: finalMessage,
          attachmentUrl: attachmentUrl || null,
          attachmentPublicId: attachmentPublicId || null,
          updateType,
          prevStatus: certificate.status,
          newStatus,
          chargesRequired: currentCharge ?? new Decimal(0),
        },
      });

      await tx.certificateRequest.update({
        where: { id: certificate.id },
        data: {
          status: newStatus,
          isResolved,
          resolvedAt,
          docRequired: pendingDocs,
          pendingPayment: pendingPay,
        },
      });
    });

    if (isUser) {
      // 🔔 Save notification in DB for admin panel
      await Notification.createAdminNotification({
        title: `New Certificate Update Received: ${certificate.requestNo}`,
        body: finalMessage,
        notificationType: "certificate",
        role: "ADMIN",
        audienceType: "SPECIFIC",
        clickAction: `/certificates`, // where admin should click
      });

      // 🔴 Emit live socket event (your existing code)
      io.to("ADMINS").emit("new-notification", {
        trackingId: certificate.requestNo,
        message: finalMessage,
        status: newStatus,
        createdAt: new Date(),
        clickAction: `/certificates`,
      });
    }

    return res.status(200).json({
      success: true,
      message: finalMessage,
      nextStatus: newStatus,
      nextAction: nextAction || "Awaiting next step.",
      paymentDue: currentCharge || null,
      pendingDocs,
      pendingPay,
    });
  } catch (error: any) {
    console.error("updateCertificateWithRoleBasedRules Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};



export const initiatePhonepePayment = async (req: Request, res: Response) => {
  const parsedData = initiateCertificatePaymentSchema.parse(req.body);
  const { amount, requestNo, paymentType = 'ADDITIONAL' } = parsedData;

  const user = (req as AuthRequest)?.auth;

  if (!user?.id)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  if (!requestNo || typeof requestNo !== "string") {
    return res.status(400).json({ message: "Invalid ticket number format" });
  }

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res
      .status(400)
      .json({ message: "Minimum payment amount is ₹1." });
  }

  try {
    // ✅ Fetch application with only its latest update
    const certificateRequest = await prisma.certificateRequest.findUnique({
      where: { requestNo },
      include: {
        updates: {
          orderBy: { createdAt: "desc" },
          take: 1, // ✅ fetch only the most recent update
        },
      },
    });

    if (!certificateRequest) {
      return res.status(404).json({ message: "certificate request not found" });
    }

    if (certificateRequest.userId !== user.id) {
      return res
        .status(403)
        .json({ message: "You are not authorized for this certificate request" });
    }

    const lastUpdate = certificateRequest.updates[0];

    if (!lastUpdate) {
      return res.status(400).json({
        success: false,
        message: "No updates found for this certificate request.",
      });
    }

    // ✅ Check if the latest update has payment pending
    if (!certificateRequest?.pendingPayment || !lastUpdate.chargesRequired) {
      return res.status(400).json({
        success: false,
        message:
          "No pending payment found in the latest update. Please refresh or contact support.",
      });
    }

    const expectedAmount = new Decimal(lastUpdate.chargesRequired);
    const providedAmount = new Decimal(amount);

    if (!expectedAmount.equals(providedAmount)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch. Expected ₹${expectedAmount.toString()} but received ₹${providedAmount.toString()}.`,
      });
    }


    await prisma.payment.updateMany({
      where: {
        applicationId: certificateRequest.id,
        status: PaymentStatus.PENDING,
      },
      data: { status: PaymentStatus.EXPIRED },
    });


    const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();
    const amountInPaise = providedAmount.mul(100).toNumber();

    // ✅ Create new payment record
    const paymentRecord = await prisma.payment.create({
      data: {
        userId: certificateRequest.userId,
        certificateRequestId: certificateRequest.id,
        transactionId: referenceId,
        paymentMethod: "PHONEPEPG",
        amount: providedAmount,
        status: PaymentStatus.PENDING,
        paymentType: paymentType as PaymentType,
        purpose:
          "Payment for additional charges on certificate request " +
          certificateRequest.requestNo,
      },
    });

    const redirectUrl =
      process.env.NODE_ENV === "development"
        ? `http://localhost:3000/payment/response?transactionReference=${referenceId}`
        : `https://legaldhara.in/payment/response?transactionReference=${referenceId}`;

    // ✅ Initiate payment via PhonePe
    const phonepeResponse = await Phonepe.initiatePayment(
      amountInPaise,
      referenceId,
      redirectUrl,
      { udf1: 'CERTIFICATE', udf2: referenceId, udf3: certificateRequest.requestNo }
    );

    if (!phonepeResponse) {
      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: { status: PaymentStatus.FAILED },
      });
      return res
        .status(400)
        .json({ success: false, message: "Failed to initiate transaction" });
    }

    return res.status(200).json({
      success: true,
      message: "Payment initiated. Proceed to pay.",
      redirectUrl: phonepeResponse.redirectUrl,
    });

  } catch (error) {
    logger.error("PhonePe Payment Initiation Error during certificate payment:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const initiateRazorpayPayment = async (req: Request, res: Response) => {
  const parsedData = initiateCertificatePaymentSchema.parse(req.body);
  const { amount, requestNo, paymentType = 'ADDITIONAL' } = parsedData;
  const user = (req as AuthRequest)?.auth;

  if (!user?.id)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  if (!requestNo || typeof requestNo !== "string") {
    return res.status(400).json({ message: "Invalid request number format" });
  }

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ message: "Minimum payment amount is ₹1." });
  }

  try {
    const certificateRequest = await prisma.certificateRequest.findUnique({
      where: { requestNo },
      include: {
        // service: true,
        updates: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!certificateRequest)
      return res.status(404).json({ message: "Certificate request not found" });

    if (certificateRequest.userId !== user.id)
      return res
        .status(403)
        .json({ message: "You are not authorized for this application" });

    const lastUpdate = certificateRequest.updates[0];
    if (!lastUpdate)
      return res
        .status(400)
        .json({ success: false, message: "No updates found for this application." });

    if (!certificateRequest.pendingPayment || !lastUpdate.chargesRequired) {
      return res.status(400).json({
        success: false,
        message: "No pending payment found in the latest update.",
      });
    }

    const expectedAmount = new Decimal(lastUpdate.chargesRequired);
    const providedAmount = new Decimal(amount);

    if (!expectedAmount.equals(providedAmount)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch. Expected ₹${expectedAmount.toString()} but received ₹${providedAmount.toString()}.`,
      });
    }

    // Expire older pending payments
    await prisma.payment.updateMany({
      where: { applicationId: certificateRequest.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.EXPIRED },
    });

    const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();
    const amountInPaise = providedAmount.mul(100).toNumber();


    // ✅ Create new payment record
    const paymentRecord = await prisma.payment.create({
      data: {
        userId: certificateRequest.userId,
        certificateRequestId: certificateRequest.id,
        transactionId: referenceId,
        paymentMethod: "RAZORPAY",
        amount: providedAmount,
        status: PaymentStatus.PENDING,
        paymentType: paymentType as PaymentType,
        purpose:
          "Payment for additional charges on certificate request " +
          certificateRequest.requestNo,
      },
    });

    // ✅ Create Razorpay order
    const razorOrder = await Razorpay.createOrder(
      amountInPaise,
      "INR",
      referenceId,
      { udf1: 'CERTIFICATE', udf2: referenceId, udf3: requestNo }
    );

    if (!razorOrder) {
      await prisma.payment.update({
        where: { id: paymentRecord.id },
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
      requestNo,
    });
  } catch (error) {
    console.error("Razorpay Payment Initiation Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

