import { Request, Response } from "express";
import { prisma } from "../config/db";
import {
  applicationSchema,
} from "../zodSchema/application.schema";
import Notification from "../services/Notification";
import { AuthRequest } from "../types/custom";
import { Decimal } from '@prisma/client/runtime/library';
import { generateTicketNumber } from "../utils/ticketGenerator";
import Phonepe from "../services/PhonePe";
import Razorpay from "../services/Razorpay";
import { logger } from "../utils/logger";
import { directApplySchema } from "../zodSchema/service.schema";
import { initiatePaymentSchema } from "../zodSchema/payment.schema";
import { formatToIndianNumber } from "../utils/lib";
import { ApplicationStatus, PaymentStatus, PaymentType, UpdateType } from "@prisma/client";
import { io } from "..";

//User
export const createUserApplicationPayment = async (req: Request, res: Response) => {
  try {
    const parsedData = directApplySchema.safeParse(req.body);
    if (!parsedData.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsedData.error.format(),
      });
    }

    const {
      fullName,
      email,
      phone,
      dob,
      gender,
      city,
      termsAccepted,
      serviceId,
      serviceFor,
      serviceName,
      businessName,
      amount,
    } = parsedData.data;

    if (!termsAccepted) {
      return res
        .status(400)
        .json({ success: false, message: "You must accept the terms and conditions." });
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ phone: formatToIndianNumber(phone) }, { email }],
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          fullName,
          email,
          phone: formatToIndianNumber(phone),
          gender,
          dob: dob ? new Date(dob) : undefined,
          isActive: false,
          city,
          termsAccepted,
          termsAcceptedAt: termsAccepted ? new Date() : undefined,
        },
      });
    }

    let application = await prisma.application.findFirst({
      where: {
        userId: user.id,
        serviceId,
        applicationStatus: ApplicationStatus.PAYMENT_REQUIRED,
      },
      include: {
        service: { select: { price: true, governmentCharges: true } },
      },
    });

    if (!application) {
      const ticketNo = generateTicketNumber('APL');
      application = await prisma.application.create({
        data: {
          userId: user.id,
          serviceId,
          serviceFor,
          serviceName,
          businessName,
          ticketNo,
          applicationStatus: ApplicationStatus.PAYMENT_REQUIRED,
        },
        include: {
          service: {
            select: {
              price: true,
              governmentCharges: true
            }
          },
        },
      });

      const servicePrice = new Decimal(application.service.price);
      const govtCharges = new Decimal(application.service.governmentCharges ?? 0);
      const totalExpected = servicePrice.add(govtCharges);

      // ✅ Log initial status update
      await prisma.applicationUpdate.create({
        data: {
          applicationId: application.id,
          updaterBy: user.id,
          updateCharges: totalExpected,
          message: "Application submitted and awaiting payment",
          prevStatus: ApplicationStatus.AWAITING_ACTION,
          newStatus: ApplicationStatus.PAYMENT_REQUIRED,
          UpdateType: UpdateType.SYSTEM_GENERATED,
          type: PaymentType.INITIAL,
        },
      });
    }

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ message: "Minimum payment amount is ₹1." });
    }

    const servicePrice = new Decimal(application.service.price);
    const govtCharges = new Decimal(application.service.governmentCharges ?? 0);

    const totalExpected = servicePrice.add(govtCharges);

    const providedPrice = new Decimal(amount);

    if (!totalExpected.equals(providedPrice)) {
      return res.status(400).json({ message: "Amount mismatch with service price." });
    }

    const amountInPaise = providedPrice.mul(100).toNumber();
    const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();


    const paymentRecord = await prisma.payment.create({
      data: {
        userId: user.id || application.userId,
        applicationId: application.id,
        serviceId: application.serviceId,
        transactionId: referenceId,
        paymentMethod: "PHONEPEPG",
        amount: providedPrice,
        status: PaymentStatus.PENDING,
        paymentType: PaymentType.INITIAL,
        purpose: "Initial Payment"
      },
    });


    const redirectUrl =
      process.env.NODE_ENV === "development"
        ? `http://localhost:3000/payment/response?transactionReference=${referenceId}`
        : `https://legaldhara.in/payment/response?transactionReference=${referenceId}`;

    const phonepeResponse = await Phonepe.initiatePayment(
      amountInPaise,
      referenceId,
      redirectUrl,
      {
        udf1: 'APPLICATION',
        udf2: referenceId,
        udf3: application.ticketNo,
      }
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
    console.error("Error in createUserApplicationPayment:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


export const createApplication = async (
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

  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.format(),
    });
  }

  const { serviceId, serviceName, serviceFor, businessName } = parsed.data;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, isActive: true, price: true, governmentCharges: true },
    });

    if (!service || !service.isActive) {
      return res.status(404).json({
        success: false,
        message: "Service not found or inactive",
      });
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ticketNo = generateTicketNumber('APL');

    // Create application without price-related data
    const newApplication = await prisma.application.create({
      data: {
        ticketNo,
        userId: user.id,
        serviceId,
        serviceName: serviceName ?? service.name,
        serviceFor,
        businessName,
        applicationStatus: ApplicationStatus.PAYMENT_REQUIRED,
        createdAt: new Date(),
      },
    });

    const totalExpected = new Decimal(service.price).add(
      new Decimal(service.governmentCharges ?? 0)
    );

    // Create initial update record (handles payment info)
    await prisma.applicationUpdate.create({
      data: {
        applicationId: newApplication.id,
        updaterBy: user.id,
        updateCharges: totalExpected,
        message: `Application submitted. Payment pending of ₹${totalExpected.toString()}`,
        pendingPayment: true,
        type: PaymentType.INITIAL,
        UpdateType: UpdateType.SYSTEM_GENERATED, // later can switch to SYSTEM_GENERATED
        prevStatus: ApplicationStatus.AWAITING_ACTION,
        newStatus: ApplicationStatus.PAYMENT_REQUIRED,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Application created successfully",
      application: {
        ...newApplication,
        totalExpected: totalExpected.toString(), // returning for frontend use only
      },
    });
  } catch (err: any) {
    console.error("Create Application Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};


export const initiatePhonepePayment = async (req: Request, res: Response) => {
  const parsedData = initiatePaymentSchema.parse(req.body);
  const { amount, ticketNo, paymentType } = parsedData;

  const user = (req as AuthRequest)?.auth;

  if (!user?.id)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  if (!ticketNo || typeof ticketNo !== "string") {
    return res.status(400).json({ message: "Invalid ticket number format" });
  }

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res
      .status(400)
      .json({ message: "Minimum payment amount is ₹1." });
  }

  try {
    // ✅ Fetch application with only its latest update
    const application = await prisma.application.findUnique({
      where: { ticketNo },
      include: {
        service: true,
        updates: {
          orderBy: { createdAt: "desc" },
          take: 1, // ✅ fetch only the most recent update
        },
      },
    });

    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    if (application.userId !== user.id) {
      return res
        .status(403)
        .json({ message: "You are not authorized for this application" });
    }

    const lastUpdate = application.updates[0];

    if (!lastUpdate) {
      return res.status(400).json({
        success: false,
        message: "No updates found for this application.",
      });
    }

    // ✅ Check if the latest update has payment pending
    if (!lastUpdate.pendingPayment || !lastUpdate.updateCharges) {
      return res.status(400).json({
        success: false,
        message:
          "No pending payment found in the latest update. Please refresh or contact support.",
      });
    }

    const expectedAmount = new Decimal(lastUpdate.updateCharges);
    const providedAmount = new Decimal(amount);

    if (!expectedAmount.equals(providedAmount)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch. Expected ₹${expectedAmount.toString()} but received ₹${providedAmount.toString()}.`,
      });
    }


    await prisma.payment.updateMany({
      where: {
        applicationId: application.id,
        status: PaymentStatus.PENDING,
      },
      data: { status: PaymentStatus.EXPIRED },
    });


    const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();
    const amountInPaise = providedAmount.mul(100).toNumber();

    // ✅ Create new payment record
    const paymentRecord = await prisma.payment.create({
      data: {
        userId: application.userId,
        applicationId: application.id,
        serviceId: application.serviceId,
        transactionId: referenceId,
        paymentMethod: "PHONEPEPG",
        amount: providedAmount,
        status: PaymentStatus.PENDING,
        paymentType: (paymentType as PaymentType) || PaymentType.INITIAL,
        purpose:
          paymentType === PaymentType.INITIAL
            ? "Initial Payment"
            : "Additional Payment",
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
      { udf1: 'APPLICATION', udf2: referenceId, udf3: ticketNo }
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

    // ✅ Link payment record to the last update
    await prisma.applicationUpdate.update({
      where: { id: lastUpdate.id },
      data: { paymentId: paymentRecord.id },
    });

    return res.status(200).json({
      success: true,
      message: "Payment initiated. Proceed to pay.",
      redirectUrl: phonepeResponse.redirectUrl,
    });
  } catch (error) {
    logger.error("PhonePe Payment Initiation Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export const initiateRazorpayPayment = async (req: Request, res: Response) => {
  const parsedData = initiatePaymentSchema.parse(req.body);
  const { amount, ticketNo, paymentType } = parsedData;
  const user = (req as AuthRequest)?.auth;

  if (!user?.id)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  if (!ticketNo || typeof ticketNo !== "string") {
    return res.status(400).json({ message: "Invalid ticket number format" });
  }

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ message: "Minimum payment amount is ₹1." });
  }

  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo },
      include: {
        service: true,
        updates: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!application)
      return res.status(404).json({ message: "Application not found" });

    if (application.userId !== user.id)
      return res
        .status(403)
        .json({ message: "You are not authorized for this application" });

    const lastUpdate = application.updates[0];
    if (!lastUpdate)
      return res
        .status(400)
        .json({ success: false, message: "No updates found for this application." });

    if (!lastUpdate.pendingPayment || !lastUpdate.updateCharges) {
      return res.status(400).json({
        success: false,
        message: "No pending payment found in the latest update.",
      });
    }

    const expectedAmount = new Decimal(lastUpdate.updateCharges);
    const providedAmount = new Decimal(amount);

    if (!expectedAmount.equals(providedAmount)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch. Expected ₹${expectedAmount.toString()} but received ₹${providedAmount.toString()}.`,
      });
    }

    // Expire older pending payments
    await prisma.payment.updateMany({
      where: { applicationId: application.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.EXPIRED },
    });

    const referenceId = Math.floor(Math.random() * 90000000 + 10000000).toString();
    const amountInPaise = providedAmount.mul(100).toNumber();

    // ✅ Create payment record
    const paymentRecord = await prisma.payment.create({
      data: {
        userId: application.userId,
        applicationId: application.id,
        serviceId: application.serviceId,
        transactionId: referenceId, // store Razorpay order_id
        paymentMethod: "RAZORPAY",
        amount: providedAmount,
        status: PaymentStatus.PENDING,
        paymentType: (paymentType as PaymentType) || PaymentType.INITIAL,
        purpose:
          paymentType === PaymentType.INITIAL
            ? "Initial Payment"
            : "Additional Payment",
      },
    });

    await prisma.applicationUpdate.update({
      where: { id: lastUpdate.id },
      data: { paymentId: paymentRecord.id },
    });

    // ✅ Create Razorpay order
    const razorOrder = await Razorpay.createOrder(
      amountInPaise,
      "INR",
      referenceId,
      { udf1: 'APPLICATION', udf2: referenceId, udf3: ticketNo }
    );

    if (!razorOrder) {
      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: { status: PaymentStatus.FAILED },
      });
      return res.status(500).json({ message: "Failed to create Razorpay order" });
    }

    return res.status(200).json({
      success: true,
      message: "Razorpay order created successfully.",
      order: razorOrder,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      ticketNo,
    });
  } catch (error) {
    console.error("Razorpay Payment Initiation Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};





export const getUserApplications = async (
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

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where: {
          userId: user.id,
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
        },
      }),
      prisma.application.count({
        where: {
          userId: user.id,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "User applications fetched successfully",
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalApplications: total,
      data: applications,
    });
  } catch (err: any) {
    console.error("Get User Applications Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

//Common
export const getApplicationById = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const { ticketNo } = req.params;
  const user = (req as AuthRequest).auth;

  if (!user || !user.id) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not found in request context",
    });
  }

  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            city: true,
            gender: true,
            dob: true,
          },
        },
        service: {
          select: {
            name: true,
          },
        },
        updates: {
          orderBy: { createdAt: "desc" },
          select: {
            message: true,
            newStatus: true,
            prevStatus: true,
            createdAt: true,
            type: true,
            meta: true,
            UpdateType: true,
            updateCharges: true,
            pendingPayment: true,
            pendingDocs: true,
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

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    // 🚫 Access control
    if (
      user.role !== "ADMIN" &&
      user.role !== "COADMIN" &&
      application.userId !== user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not authorized to view this application",
      });
    }

    // 💰 Compute total paid + payment stats
    const successfulPayments = application.payments.filter(
      (p) => p.status === "SUCCESS"
    );
    const totalPaid = successfulPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    const paymentCount = application.payments.length;
    const latestUpdate = application.updates[0] || null;
    const isExpired =
      application.autoCloseAt && new Date(application.autoCloseAt) < new Date();



    const structuredResponse = {
      ticketNo: application.ticketNo,
      applicationStatus: application.applicationStatus,
      objectionReason: application.objectionReason,
      businessName: application.businessName,
      serviceFor: application.serviceFor,
      createdAt: application.createdAt,
      autoCloseAt: application.autoCloseAt,
      isExpired,
      totalPaid,
      paymentCount,

      userDetails: application.user,
      serviceName: application.service.name,

      paymentHistory: application.payments,
      updateHistory: application.updates,
    };

    return res.status(200).json({
      success: true,
      message: "Application details fetched successfully",
      data: structuredResponse,
    });
  } catch (err: any) {
    console.error("Get Application Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};


export const getApplicationUpdates = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const applicationId = req.params.ticketNo;
  const user = (req as AuthRequest).auth;

  if (!applicationId) {
    return res.status(400).json({
      success: false,
      message: "Application ID is required in the URL",
    });
  }

  if (!user || !user.id) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: User not authenticated",
    });
  }

  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo: applicationId },
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (application.userId !== user.id && user.role === "USER") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view these updates",
      });
    }

    const updates = await prisma.applicationUpdate.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "desc" },
      include: {
        updater: {
          select: {
            fullName: true,
            role: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Application updates fetched successfully",
      TicketNo: applicationId,
      updates
    });
  } catch (err: any) {
    console.error("Get Application Updates Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

export const createApplicationUpdate = async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).auth;
  const { ticketNo } = req.params;

  if (!ticketNo) {
    return res.status(400).json({ success: false, message: "Ticket number is required." });
  }

  const {
    message,
    updateCharges,
    docRequired,
    meta,
    paymentRequired,
    statusAction,
    updateType,
  } = req.body;

  if (!actor || !actor.id) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo },
      include: { updates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!application)
      return res.status(404).json({ success: false, message: "Application not found." });

    const isAdmin = actor.role === "ADMIN" || actor.role === "COADMIN";
    const isUser = actor.role === "USER";

    if (isUser && application.userId !== actor.id) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const lastUpdate = application.updates?.[0];
    let newStatus = application.applicationStatus;
    let finalMessage = message || "Update added successfully.";
    let responseMeta = meta ? (meta as object) : {};
    let pendingDocs = false;
    let pendingPayment = false;
    let nextAction: string | null = null;
    let type: UpdateType = updateType || (isAdmin ? UpdateType.ADMIN_MESSAGE : UpdateType.USER_MESSAGE);
    let currentCharge: Decimal | null = lastUpdate?.updateCharges ? new Decimal(lastUpdate.updateCharges) : null;

    // ❌ Block updates on final states
    if ([ApplicationStatus.CLOSED, ApplicationStatus.COMPLETED as ApplicationStatus].includes(application.applicationStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${application.applicationStatus.toLowerCase()} application.`,
      });
    }

    // ==========================================================
    // 🧑‍💼 ADMIN ACTIONS
    // ==========================================================
    if (isAdmin) {
      if (docRequired) {
        newStatus = ApplicationStatus.DATA_REQUIRED;
        pendingDocs = true;
        type = UpdateType.STATUS_CHANGE;
        finalMessage = message || "Admin requested additional documents.";
        nextAction = "User must upload requested documents.";
      }

      if (paymentRequired && updateCharges) {
        newStatus = ApplicationStatus.PAYMENT_REQUIRED;
        pendingPayment = true;
        type = UpdateType.PAYMENT_REQUESTED;
        currentCharge = new Decimal(updateCharges);
        finalMessage = message || `Payment of ₹${updateCharges} requested by admin.`;
        nextAction = "User must complete payment.";

        // 🧹 Clean old charge entry
        if (lastUpdate?.id) {
          await prisma.applicationUpdate.update({
            where: { id: lastUpdate.id },
            data: { updateCharges: new Decimal(0) },
          });
        }
      }

      if (statusAction) {
        const validStatuses = ["DATA_REQUIRED", "REJECTED", "APPROVED", "COMPLETED", "CLOSED"];
        if (validStatuses.includes(statusAction)) {
          newStatus = statusAction as ApplicationStatus;
          type = UpdateType.STATUS_CHANGE;
          finalMessage = message || `Application marked as ${statusAction.split('_').join(' ').toLowerCase()} by admin.`;
        }
      }

      // If admin sends message under PAYMENT_REQUIRED, preserve the last valid charge
      if (application.applicationStatus === ApplicationStatus.PAYMENT_REQUIRED && !updateCharges && lastUpdate?.updateCharges) {
        currentCharge = new Decimal(lastUpdate.updateCharges);
        pendingPayment = true;
      }
    }

    // ==========================================================
    // 🙋 USER ACTIONS
    // ==========================================================
    if (isUser) {
      // ✅ User cannot change status or charge
      if (statusAction || updateCharges) {
        return res.status(403).json({
          success: false,
          message: "Users are not allowed to modify status or payment charges.",
        });
      }

      // 🗂️ Handle requested document uploads
      if (lastUpdate?.pendingDocs) {
        if (!meta?.documents || meta.documents.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Please upload required documents.",
          });
        }

        newStatus = ApplicationStatus.UNDER_REVIEW;
        type = UpdateType.DOCUMENT_UPDATED;
        finalMessage = message || "User uploaded requested documents.";
        nextAction = "Documents received, awaiting admin review.";
      }

      // 💬 User messaging under PAYMENT_REQUIRED (keep charge info)
      if (application.applicationStatus === ApplicationStatus.PAYMENT_REQUIRED && lastUpdate?.updateCharges) {
        currentCharge = new Decimal(lastUpdate.updateCharges);
        pendingPayment = true;
      }
    }

    // ==========================================================
    // 🧩 TRANSACTION — Create Update + Update Application
    // ==========================================================
    await prisma.$transaction(async (tx) => {
      await tx.applicationUpdate.create({
        data: {
          applicationId: application.id,
          updaterBy: actor.id,
          message: finalMessage,
          prevStatus: application.applicationStatus,
          newStatus,
          meta: responseMeta,
          updateCharges: currentCharge ?? new Decimal(0),
          pendingDocs,
          pendingPayment,
          UpdateType: type,
        },
      });

      if (newStatus !== application.applicationStatus) {
        await tx.application.update({
          where: { id: application.id },
          data: { applicationStatus: newStatus },
        });
      }
    });


    if (isUser) {
      // 🔔 Save notification in DB for admin panel
      await Notification.createAdminNotification({
        title: `New Update on ${application.ticketNo}`,
        body: finalMessage,
        notificationType: "applicatio",
        role: "ADMIN",
        audienceType: "SPECIFIC",
        clickAction: `/admin/applications/${application.ticketNo}`, // where admin should click
      });

      // 🔴 Emit live socket event (your existing code)
      io.to("ADMINS").emit("new-notification", {
        ticketNo: application.ticketNo,
        message: finalMessage,
        status: newStatus,
        createdAt: new Date(),
        clickAction: `/admin/applications/${application.ticketNo}`,
      });
    }

    return res.status(200).json({
      success: true,
      message: finalMessage,
      nextStatus: newStatus,
      nextAction: nextAction || "Awaiting next step.",
      paymentDue: pendingPayment ? currentCharge : null,
      pendingDocuments: pendingDocs,
    });
  } catch (err: any) {
    console.error("Create Application Update Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: err.message,
    });
  }
};


//Admin
export const getAllApplications = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  try {
    const user = (req as AuthRequest).auth;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { status, search, startDate, endDate } = req.query;

    // 🔍 Build dynamic filters
    const where: any = {};

    if (user.role !== "ADMIN" && user.role !== "COADMIN") {
      where.userId = user.id; // users see only their own
    }

    if (status) {
      where.applicationStatus = status;
    }

    if (search) {
      where.OR = [
        { ticketNo: { contains: String(search), mode: "insensitive" } },
        { serviceName: { contains: String(search), mode: "insensitive" } },
        { user: { fullName: { contains: String(search), mode: "insensitive" } } },
      ];
    }

    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(String(startDate)),
        lte: new Date(String(endDate)),
      };
    }

    // ⚙️ Fetch data + total count atomically
    const [applications, total] = await prisma.$transaction([
      prisma.application.findMany({
        skip,
        take: limit,
        where,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              fullName: true,
            },
          },
          service: {
            select: {
              name: true,
            },
          },
          updates: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              updateCharges: true,
              pendingPayment: true,
              pendingDocs: true,
              createdAt: true,
              UpdateType: true,
            },
          },
          payments: {
            select: { amount: true, status: true },
          },
        },
      }),
      prisma.application.count({ where }),
    ]);

    const formatted = applications.map((app) => {
      const successfulPayments = app.payments.filter(
        (p) => p.status === "SUCCESS"
      );
      const totalPaid = successfulPayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const paymentCount = app.payments.length;
      const isExpired =
        app.autoCloseAt && new Date(app.autoCloseAt) < new Date();

      return {
        ...app,
        totalPaid,
        paymentCount,
        isExpired,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Applications fetched successfully",
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalApplications: total,
      data: formatted,
    });
  } catch (err: any) {
    console.error("Get All Applications Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};


export const deleteApplication = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const appId = req.params.id;

  try {
    const application = await prisma.application.findUnique({
      where: { id: appId },
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    await prisma.application.delete({
      where: { id: appId },
    });

    return res.status(200).json({
      success: true,
      message: "Application deleted successfully",
    });
  } catch (err: any) {
    console.error("Delete Application Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};
