import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db";
import { AuthRequest } from "../types/custom";
import { createCertificateRequestSchema } from "../zodSchema/certificate.schema";
import { generateTicketNumber } from "../utils/ticketGenerator";
import Notification from "../services/Notification";
import { getIo } from "../socket";
import { serializeLifecycle } from "../modules/cases/serializer";
import { verifyMfaProof } from "../services/adminMfa";

const certificateView = <T extends { requestCase: { status: string } | null }>(request: T) => ({
  ...request,
  status: request.requestCase?.status ?? "SUBMITTED",
  isResolved: ["COMPLETED", "CLOSED", "REJECTED"].includes(request.requestCase?.status ?? ""),
});

export const createCertificateRequest = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  const parsed = createCertificateRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.format() });
  try {
    const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, fullName: true } });
    if (!user) return response.status(404).json({ success: false, message: "User not found" });
    const duplicate = await prisma.certificateRequest.findFirst({
      where: { userId: actor.id, subject: { equals: parsed.data.subject, mode: "insensitive" }, deletedAt: null, requestCase: { is: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED"] } } } },
    });
    if (duplicate) return response.status(409).json({ success: false, message: "You already have an active request for this subject." });
    const created = await prisma.$transaction(async (transaction) => {
      const certificate = await transaction.certificateRequest.create({ data: { requestNo: generateTicketNumber("CER"), userId: actor.id, subject: parsed.data.subject, description: parsed.data.description } });
      const requestCase = await transaction.requestCase.create({ data: { type: "CERTIFICATE", ownerId: actor.id, certificateRequestId: certificate.id } });
      await transaction.caseEvent.create({ data: { caseId: requestCase.id, actorId: actor.id, actorRoleSnapshot: actor.role, type: "CASE_SUBMITTED", previousStatus: "SUBMITTED", newStatus: "SUBMITTED", idempotencyKey: `create:${certificate.id}`, result: { caseId: requestCase.id } } });
      return certificate;
    });
    await Notification.createAdminNotification({ title: `New Certificate Request Received: #${created.requestNo}`, body: `A new certificate request has been submitted by ${user.fullName}.`, notificationType: "certificate", role: "ADMIN", audienceType: "SPECIFIC", clickAction: "/certificates" });
    getIo().to("ADMINS").emit("new-notification", { trackingId: created.requestNo, message: `New certificate request submitted by ${user.fullName}`, status: "submitted", createdAt: new Date(), clickAction: "/certificates" });
    return response.status(201).json({ success: true, message: "Certificate request submitted successfully.", data: { ...created, status: "SUBMITTED", isResolved: false } });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const getAllCertificateRequests = async (request: Request, response: Response) => {
  const page = Number(request.query.page) || 1;
  const limit = Number(request.query.limit) || 10;
  const search = String(request.query.search || "").trim();
  const where: Prisma.CertificateRequestWhereInput = { deletedAt: null, ...(search ? { OR: [
    { subject: { contains: search, mode: "insensitive" as const } }, { requestNo: { contains: search, mode: "insensitive" as const } },
    { user: { is: { OR: [{ fullName: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }, { phone: { contains: search, mode: "insensitive" as const } }] } } },
  ] } : {}) };
  try {
    const [requests, totalCount] = await Promise.all([
      prisma.certificateRequest.findMany({ skip: (page - 1) * limit, take: limit, where, orderBy: { createdAt: "desc" }, include: { user: { select: { fullName: true, email: true, phone: true } }, requestCase: { select: { status: true } } } }),
      prisma.certificateRequest.count({ where }),
    ]);
    return response.json({ success: true, requests: requests.map(certificateView), pagination: { totalCount, totalPages: Math.ceil(totalCount / limit), page, limit } });
  } catch {
    return response.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserCertificateRequests = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  const page = Number(request.query.page) || 1;
  const limit = Number(request.query.limit) || 10;
  try {
    const [requests, total] = await Promise.all([
      prisma.certificateRequest.findMany({ where: { userId: actor.id, deletedAt: null }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { requestCase: { select: { status: true } } } }),
      prisma.certificateRequest.count({ where: { userId: actor.id, deletedAt: null } }),
    ]);
    return response.json({ success: true, data: requests.map(certificateView), pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch {
    return response.status(500).json({ success: false, message: "Server error" });
  }
};

export const getCertificateRequestByRequestNo = async (request: Request, response: Response) => {
  const actor = (request as AuthRequest).auth;
  try {
    const certificate = await prisma.certificateRequest.findUnique({ where: { requestNo: request.params.requestNo }, include: {
      user: { select: { fullName: true, email: true, phone: true } }, paymentCharges: { orderBy: { createdAt: "desc" }, select: { id: true, amountMinor: true, currency: true, status: true, purpose: true, category: true, paidAt: true, createdAt: true } },
      requestCase: { select: { id: true, status: true } },
    } });
    if (!certificate) return response.status(404).json({ success: false, message: "Certificate request not found" });
    if (actor.role === "USER" && certificate.userId !== actor.id) return response.status(403).json({ success: false, message: "Forbidden" });
    const lifecycle = certificate.requestCase ? await serializeLifecycle(certificate.requestCase.id, {
      id: actor.id, role: actor.role, ownsCase: certificate.userId === actor.id,
      mfaVerified: actor.role !== "USER" && verifyMfaProof(request.cookies?.["__Host-admin_mfa"] || "", actor.uid),
    }) : null;
    const paid = certificate.paymentCharges.filter((payment) => payment.status === "PAID");
    const data = {
      requestNo: certificate.requestNo, subject: certificate.subject, description: certificate.description, status: lifecycle?.case.status ?? "SUBMITTED",
      isResolved: ["COMPLETED", "CLOSED", "REJECTED"].includes(lifecycle?.case.status ?? ""), createdAt: certificate.createdAt,
      totalPaid: paid.reduce((sum, payment) => sum + payment.amountMinor / 100, 0), paymentCount: certificate.paymentCharges.length,
      latestUpdate: lifecycle?.timeline[lifecycle.timeline.length - 1] ?? null, userDetails: certificate.user, paymentHistory: certificate.paymentCharges,
      updateHistory: lifecycle?.timeline ?? [], lifecycle,
    };
    return response.json({ success: true, message: "Certificate request fetched successfully", data, lifecycle });
  } catch (error: any) {
    return response.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
