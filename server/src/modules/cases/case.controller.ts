import { Request, Response } from "express";
import { AuthRequest } from "../../types/custom";
import { verifyMfaProof } from "../../services/adminMfa";
import { prisma } from "../../config/db";
import { prismaCaseRepository } from "./repository";
import { createCaseService } from "./service";
import { serializeLifecycle } from "./serializer";
import { CaseDomainError, type CaseActor } from "./types";

const service = createCaseService(prismaCaseRepository);

const actorFor = (request: Request): CaseActor => {
  const auth = (request as AuthRequest).auth;
  return {
    id: auth.id,
    role: auth.role,
    ownsCase: auth.role === "USER",
    mfaVerified: auth.role !== "USER" && verifyMfaProof(request.cookies?.["__Host-admin_mfa"] || "", auth.uid),
  };
};

const respond = async (response: Response, operation: () => Promise<unknown>) => {
  try {
    response.status(200).json({ success: true, data: await operation() });
  } catch (error) {
    if (error instanceof CaseDomainError) {
      response.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
      return;
    }
    throw error;
  }
};

const command = (request: Request, caseId = request.params.caseId) => ({
  actor: actorFor(request),
  caseId,
  expectedVersion: request.body.expectedVersion,
  idempotencyKey: request.body.idempotencyKey,
});

export const getCase = async (request: Request, response: Response) =>
  respond(response, () => serializeLifecycle(request.params.caseId, actorFor(request)));

export const startReview = async (request: Request, response: Response) =>
  respond(response, () => service.startReview(command(request)));

export const postMessage = async (request: Request, response: Response) =>
  respond(response, () => service.postMessage({ ...command(request), message: request.body.message }));

export const requestDocuments = async (request: Request, response: Response) =>
  respond(response, () => service.requestDocuments({ ...command(request), ...request.body }));

export const submitDocuments = async (request: Request, response: Response) =>
  respond(response, () => service.submitDocuments({
    ...command(request),
    requirementId: request.params.requirementId,
    assets: request.body.assets,
  }));

export const requestPayment = async (request: Request, response: Response) =>
  respond(response, () => service.requestPayment({ ...command(request), ...request.body }));

export const cancelRequirement = async (request: Request, response: Response) =>
  respond(response, () => service.cancelRequirement({
    ...command(request),
    requirementId: request.params.requirementId,
    reason: request.body.reason,
  }));

export const approveCase = async (request: Request, response: Response) =>
  respond(response, () => service.approveCase(command(request)));

export const rejectCase = async (request: Request, response: Response) =>
  respond(response, () => service.rejectCase({ ...command(request), reason: request.body.reason }));

export const attachDeliverable = async (request: Request, response: Response) =>
  respond(response, () => service.attachDeliverable({ ...command(request), ...request.body }));

export const completeCase = async (request: Request, response: Response) =>
  respond(response, () => service.completeCase({ ...command(request), ...request.body }));

export const closeCase = async (request: Request, response: Response) =>
  respond(response, () => service.closeCase(command(request)));

export const legacyApplicationMessage = async (request: Request, response: Response) =>
  respond(response, async () => {
    const application = await prisma.application.findUnique({
      where: { ticketNo: request.params.ticketNo },
      select: { requestCase: { select: { id: true } } },
    });
    if (!application?.requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
    return service.postMessage({
      ...command(request, application.requestCase.id),
      message: request.body.message,
    });
  });

export const legacyCertificateMessage = async (request: Request, response: Response) =>
  respond(response, async () => {
    const certificate = await prisma.certificateRequest.findUnique({
      where: { requestNo: request.params.requestNo },
      select: { requestCase: { select: { id: true } } },
    });
    if (!certificate?.requestCase) throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
    return service.postMessage({
      ...command(request, certificate.requestCase.id),
      message: request.body.message,
    });
  });
