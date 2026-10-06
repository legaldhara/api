import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../config/db";
import { applicationSchema } from "../zodSchema/application.schema";
import { AuthRequest } from "../types/custom";
import { generateTicketNumber } from "../utils/ticketGenerator";
import { createCharge } from "../modules/payments/chargeService";
import { applicationChargeInput } from "../modules/payments/domainChargeCreation";
import { createPaymentChargeRepository } from "../modules/payments/repository";
import { createPrismaCaseNotification } from "../modules/cases/repository";
import { serializeLifecycle } from "../modules/cases/serializer";
import { verifyMfaProof } from "../services/adminMfa";

const lifecycleActor = (request: Request, ownerId: string) => {
  const actor = (request as AuthRequest).auth;
  return {
    id: actor.id,
    role: actor.role,
    ownsCase: actor.id === ownerId,
    mfaVerified: actor.role !== "USER" && verifyMfaProof(request.cookies?.["__Host-admin_mfa"] || "", actor.uid),
  } as const;
};

const applicationView = <T extends { requestCase: { status: string } | null }>(application: T) => ({
  ...application,
  applicationStatus: application.requestCase?.status ?? "SUBMITTED",
});

export const createApplication = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  const parsed = applicationSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.format() });

  try {
    const service = await prisma.service.findUnique({
      where: { id: parsed.data.serviceId },
      select: { id: true, name: true, isActive: true, price: true, governmentCharges: true },
    });
    if (!service?.isActive) return response.status(404).json({ success: false, message: "Service not found or inactive" });
    const totalExpected = new Decimal(service.price).add(service.governmentCharges ?? 0);
    const ticketNo = generateTicketNumber("APL");

    const result = await prisma.$transaction(async (transaction) => {
      const application = await transaction.application.create({
        data: {
          ticketNo,
          userId: actor.id,
          serviceId: service.id,
          serviceName: parsed.data.serviceName ?? service.name,
          serviceFor: parsed.data.serviceFor,
          businessName: parsed.data.businessName,
        },
      });
      const charge = await createCharge(applicationChargeInput({
        userId: actor.id,
        applicationId: application.id,
        servicePrice: service.price,
        governmentCharges: service.governmentCharges ?? 0,
        category: "INITIAL",
      }), { repository: createPaymentChargeRepository(transaction) });
      const requestCase = await transaction.requestCase.create({
        data: { type: "APPLICATION", ownerId: actor.id, applicationId: application.id, status: "ACTION_REQUIRED", version: 1 },
      });
      await transaction.caseEvent.create({
        data: { caseId: requestCase.id, actorId: actor.id, actorRoleSnapshot: actor.role, type: "CASE_SUBMITTED", previousStatus: "SUBMITTED", newStatus: "SUBMITTED", idempotencyKey: `create:${application.id}`, result: { caseId: requestCase.id } },
      });
      const requirement = await transaction.caseRequirement.create({
        data: { caseId: requestCase.id, type: "PAYMENT", status: "OPEN", createdBy: actor.id, title: "Initial payment required", instructions: charge.purpose, documentLabels: [], paymentChargeId: charge.id },
      });
      const event = await transaction.caseEvent.create({
        data: { caseId: requestCase.id, actorId: actor.id, actorRoleSnapshot: actor.role, type: "PAYMENT_REQUESTED", previousStatus: "SUBMITTED", newStatus: "ACTION_REQUIRED", requirementId: requirement.id, paymentChargeId: charge.id, idempotencyKey: `initial-payment:${charge.id}`, result: { caseId: requestCase.id, requirementId: requirement.id, chargeId: charge.id } },
      });
      await createPrismaCaseNotification(transaction, {
        caseId: requestCase.id, eventId: event.id, recipientId: actor.id, channels: ["IN_APP", "EMAIL"], title: "Payment required",
        body: "An initial payment is required to continue processing your request.", templateKey: "case_payment_requested", clickAction: `/dashboard/cases/${requestCase.id}`,
      });
      return { application, charge };
    });

    return response.status(201).json({
      success: true,
      message: "Application created successfully",
      application: { ...result.application, applicationStatus: "ACTION_REQUIRED", totalExpected: totalExpected.toString(), chargeId: result.charge.id, amountMinor: result.charge.amountMinor, currency: result.charge.currency, purpose: result.charge.purpose },
    });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

export const getUserApplications = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  try {
    const applications = await prisma.application.findMany({
      where: { userId: actor.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { service: true, requestCase: { select: { status: true } } },
    });
    return response.json({ success: true, data: applications.map(applicationView) });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const getApplicationById = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  try {
    const application = await prisma.application.findUnique({
      where: { ticketNo: request.params.ticketNo },
      include: {
        user: { select: { fullName: true, email: true, phone: true, city: true, gender: true, dob: true } },
        service: { select: { name: true } },
        paymentCharges: { orderBy: { createdAt: "desc" }, select: { id: true, amountMinor: true, currency: true, status: true, purpose: true, category: true, paidAt: true, createdAt: true } },
        requestCase: { select: { id: true, status: true } },
      },
    });
    if (!application) return response.status(404).json({ success: false, message: "Application not found" });
    if (actor.role === "USER" && application.userId !== actor.id) return response.status(403).json({ success: false, message: "Forbidden" });
    const lifecycle = application.requestCase ? await serializeLifecycle(application.requestCase.id, lifecycleActor(request, application.userId)) : null;
    const paid = application.paymentCharges.filter((payment) => payment.status === "PAID");
    const data = {
      ticketNo: application.ticketNo, applicationStatus: lifecycle?.case.status ?? "SUBMITTED", objectionReason: application.objectionReason,
      businessName: application.businessName, serviceFor: application.serviceFor, createdAt: application.createdAt, autoCloseAt: application.autoCloseAt,
      isExpired: Boolean(application.autoCloseAt && application.autoCloseAt < new Date()), totalPaid: paid.reduce((sum, payment) => sum + payment.amountMinor / 100, 0),
      paymentCount: application.paymentCharges.length, userDetails: application.user, serviceName: application.service.name,
      paymentHistory: application.paymentCharges, updateHistory: lifecycle?.timeline ?? [], lifecycle,
    };
    return response.json({ success: true, message: "Application details fetched successfully", data, lifecycle });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const getAllApplications = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  const page = Number(request.query.page) || 1;
  const limit = Number(request.query.limit) || 10;
  const where: Prisma.ApplicationWhereInput = { deletedAt: null };
  if (actor.role === "USER") where.userId = actor.id;
  if (request.query.status) where.requestCase = { is: { status: String(request.query.status) as any } };
  if (request.query.search) where.OR = [
    { ticketNo: { contains: String(request.query.search), mode: "insensitive" } },
    { serviceName: { contains: String(request.query.search), mode: "insensitive" } },
    { user: { fullName: { contains: String(request.query.search), mode: "insensitive" } } },
  ];
  if (request.query.startDate && request.query.endDate) where.createdAt = { gte: new Date(String(request.query.startDate)), lte: new Date(String(request.query.endDate)) };
  try {
    const [applications, total] = await prisma.$transaction([
      prisma.application.findMany({ skip: (page - 1) * limit, take: limit, where, orderBy: { createdAt: "desc" }, include: {
        user: { select: { fullName: true } }, service: { select: { name: true } }, requestCase: { select: { status: true, requirements: { where: { status: "OPEN" }, select: { type: true } } } },
        paymentCharges: { select: { id: true, amountMinor: true, status: true } },
      } }),
      prisma.application.count({ where }),
    ]);
    const data = applications.map((application) => ({
      ...applicationView(application),
      updates: application.requestCase ? [{ pendingPayment: application.requestCase.requirements.some((item) => item.type === "PAYMENT"), pendingDocs: application.requestCase.requirements.some((item) => item.type === "DOCUMENT") }] : [],
      totalPaid: application.paymentCharges.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amountMinor / 100, 0),
      paymentCount: application.paymentCharges.length,
    }));
    return response.json({ success: true, page, limit, totalPages: Math.ceil(total / limit), totalApplications: total, data });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};

export const deleteApplication = async (request: Request, response: Response) => {
  try {
    const application = await prisma.application.findUnique({ where: { ticketNo: request.params.ticketNo }, include: { requestCase: { select: { status: true } } } });
    if (!application) return response.status(404).json({ success: false, message: "Application not found" });
    if (application.requestCase?.status !== "CLOSED") return response.status(409).json({ success: false, message: "Close the request before deleting it." });
    await prisma.application.update({ where: { id: application.id }, data: { deletedAt: new Date() } });
    return response.json({ success: true, message: "Application deleted successfully" });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
