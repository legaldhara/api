import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../config/db";
import {
  applicationSchema,
} from "../zodSchema/application.schema";
import Notification from "../services/Notification";
import { AuthRequest } from "../types/custom";
import { Decimal } from '@prisma/client/runtime/library';
import { generateTicketNumber } from "../utils/ticketGenerator";
import { ApplicationStatus, PaymentType, Prisma, UpdateType } from "@prisma/client";
import { getIo } from "../socket";
import { AssetAccessError, claimAssetReferences, createAssetRepository, extractAssetIds } from "../services/uploadedAsset";
import { createCharge } from "../modules/payments/chargeService";
import { applicationChargeInput } from "../modules/payments/domainChargeCreation";
import { createPaymentChargeRepository } from "../modules/payments/repository";
import { createPrismaCaseNotification } from "../modules/cases/repository";
import { serializeLifecycle } from "../modules/cases/serializer";
import { verifyMfaProof } from "../services/adminMfa";

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

    const totalExpected = new Decimal(service.price).add(
      new Decimal(service.governmentCharges ?? 0)
    );
    const { newApplication, charge } = await prisma.$transaction(async (tx) => {
      const newApplication = await tx.application.create({
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
      const initialUpdate = await tx.applicationUpdate.create({
        data: {
          applicationId: newApplication.id,
          updaterBy: user.id,
          updateCharges: totalExpected,
          message: `Application submitted. Payment pending of ₹${totalExpected.toString()}`,
          pendingPayment: true,
          type: PaymentType.INITIAL,
          UpdateType: UpdateType.SYSTEM_GENERATED,
          prevStatus: ApplicationStatus.AWAITING_ACTION,
          newStatus: ApplicationStatus.PAYMENT_REQUIRED,
        },
      });
      const charge = await createCharge(applicationChargeInput({
        userId: user.id,
        applicationId: newApplication.id,
        sourceUpdateId: initialUpdate.id,
        servicePrice: service.price,
        governmentCharges: service.governmentCharges ?? 0,
        category: "INITIAL",
      }), { repository: createPaymentChargeRepository(tx) });
      const requestCase = await tx.requestCase.create({
        data: { type: "APPLICATION", ownerId: user.id, applicationId: newApplication.id, status: "ACTION_REQUIRED", version: 1 },
      });
      await tx.caseEvent.create({
        data: {
          caseId: requestCase.id,
          type: "CASE_SUBMITTED",
          previousStatus: "SUBMITTED",
          newStatus: "SUBMITTED",
          idempotencyKey: `create:${newApplication.id}`,
          result: { caseId: requestCase.id },
        },
      });
      const requirement = await tx.caseRequirement.create({
        data: {
          caseId: requestCase.id,
          type: "PAYMENT",
          status: "OPEN",
          createdBy: user.id,
          title: "Initial payment required",
          instructions: charge.purpose,
          documentLabels: [],
          paymentChargeId: charge.id,
        },
      });
      const paymentEvent = await tx.caseEvent.create({
        data: {
          caseId: requestCase.id,
          type: "PAYMENT_REQUESTED",
          previousStatus: "SUBMITTED",
          newStatus: "ACTION_REQUIRED",
          requirementId: requirement.id,
          paymentChargeId: charge.id,
          idempotencyKey: `initial-payment:${charge.id}`,
          result: { caseId: requestCase.id, requirementId: requirement.id, chargeId: charge.id },
        },
      });
      await createPrismaCaseNotification(tx, {
        caseId: requestCase.id,
        eventId: paymentEvent.id,
        recipientId: user.id,
        channels: ["IN_APP", "EMAIL"],
        title: "Payment required",
        body: "An initial payment is required to continue processing your request.",
        templateKey: "case_payment_requested",
        clickAction: `/dashboard/cases/${requestCase.id}`,
      });
      return { newApplication, charge };
    });

    return res.status(201).json({
      success: true,
      message: "Application created successfully",
      application: {
        ...newApplication,
        totalExpected: totalExpected.toString(),
        chargeId: charge.id,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        purpose: charge.purpose,
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
        paymentCharges: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amountMinor: true,
            currency: true,
            status: true,
            purpose: true,
            category: true,
            paidAt: true,
            createdAt: true,
          },
        },
        requestCase: { select: { id: true } },
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
    const successfulPayments = application.paymentCharges.filter(
      (payment) => payment.status === "PAID"
    );
    const totalPaid = successfulPayments.reduce(
      (sum, payment) => sum + payment.amountMinor / 100,
      0
    );

    const paymentCount = application.paymentCharges.length;
    const latestUpdate = application.updates[0] || null;
    const isExpired =
      application.autoCloseAt && new Date(application.autoCloseAt) < new Date();



    const lifecycle = application.requestCase
      ? await serializeLifecycle(application.requestCase.id, {
          id: user.id,
          role: user.role,
          ownsCase: application.userId === user.id,
          mfaVerified: user.role !== "USER" && verifyMfaProof(req.cookies?.["__Host-admin_mfa"] || "", user.uid),
        })
      : null;
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

      paymentHistory: application.paymentCharges,
      updateHistory: application.updates,
      lifecycle,
    };

    return res.status(200).json({
      success: true,
      message: "Application details fetched successfully",
      data: structuredResponse,
      lifecycle,
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
    const attachmentAssetIds = extractAssetIds(meta);
    const { documents: _ignoredDocuments, ...safeMeta } = meta && typeof meta === "object" ? meta : {};
    let responseMeta = safeMeta;
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
        if (attachmentAssetIds.length === 0) {
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
    const updateId = randomUUID();
    const paymentCharge = await prisma.$transaction(async (tx) => {
      const documents = await claimAssetReferences({
        assetIds: attachmentAssetIds,
        actor,
        context: "APPLICATION_UPDATE",
        referenceId: updateId,
      }, { repository: createAssetRepository(tx) });
      responseMeta = { ...safeMeta, ...(documents.length > 0 && { documents }) };
      await tx.applicationUpdate.create({
        data: {
          id: updateId,
          applicationId: application.id,
          updaterBy: actor.id,
          message: finalMessage,
          prevStatus: application.applicationStatus,
          newStatus,
          meta: responseMeta as Prisma.InputJsonValue,
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
      return isAdmin && pendingPayment && currentCharge
        ? createCharge(applicationChargeInput({
            userId: application.userId,
            applicationId: application.id,
            sourceUpdateId: updateId,
            servicePrice: currentCharge,
            governmentCharges: 0,
            category: "ADDITIONAL",
          }), { repository: createPaymentChargeRepository(tx) })
        : null;
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
      getIo().to("ADMINS").emit("new-notification", {
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
      paymentCharge: paymentCharge ? {
        chargeId: paymentCharge.id,
        amountMinor: paymentCharge.amountMinor,
        currency: paymentCharge.currency,
        purpose: paymentCharge.purpose,
      } : null,
      pendingDocuments: pendingDocs,
    });
  } catch (err: any) {
    if (err instanceof AssetAccessError) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
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
          paymentCharges: {
            select: { id: true, amountMinor: true, status: true },
          },
        },
      }),
      prisma.application.count({ where }),
    ]);

    const formatted = applications.map((app) => {
      const successfulPayments = app.paymentCharges.filter(
        (payment) => payment.status === "PAID"
      );
      const totalPaid = successfulPayments.reduce(
        (sum, payment) => sum + payment.amountMinor / 100,
        0
      );
      const paymentCount = app.paymentCharges.length;
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
  const ticketNo = req.params.ticketNo;

  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo },
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (([ApplicationStatus.COMPLETED, ApplicationStatus.CLOSED] as ApplicationStatus[]).includes(application.applicationStatus)) {
      return res.status(409).json({ success: false, message: "Finalized applications cannot be cancelled." });
    }

    await prisma.$transaction([
      prisma.paymentCharge.updateMany({
        where: { applicationId: application.id, status: "OPEN" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      }),
      prisma.application.update({
        where: { id: application.id },
        data: { applicationStatus: ApplicationStatus.CLOSED, deletedAt: new Date() },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Application cancelled successfully",
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
