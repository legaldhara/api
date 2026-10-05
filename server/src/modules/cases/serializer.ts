import { prisma } from "../../config/db";
import { availableCaseActions } from "./transitionPolicy";
import { CaseDomainError, type CaseActor } from "./types";

export const serializeLifecycle = async (caseId: string, actor: CaseActor) => {
  const requestCase = await prisma.requestCase.findUnique({
    where: { id: caseId },
    include: {
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      requirements: {
        orderBy: { createdAt: "asc" },
        include: {
          paymentCharge: { select: { id: true, amountMinor: true, currency: true, purpose: true, status: true } },
          assets: {
            include: {
              asset: { select: { id: true, secureUrl: true, mimeType: true, originalName: true, sizeBytes: true } },
            },
          },
        },
      },
      assets: {
        where: { purpose: "FINAL_DELIVERABLE" },
        include: {
          asset: { select: { id: true, secureUrl: true, mimeType: true, originalName: true, sizeBytes: true } },
        },
      },
      _count: { select: { requirements: { where: { status: "OPEN" } } } },
    },
  });
  if (!requestCase || (actor.role === "USER" && requestCase.ownerId !== actor.id)) {
    throw new CaseDomainError("Case not found", 404, "CASE_NOT_FOUND");
  }

  const caseActor = { ...actor, ownsCase: requestCase.ownerId === actor.id };
  const hasCompletionRecord = requestCase.assets.length > 0 || requestCase.events.some(
    (event) => event.type === "CASE_COMPLETED" && Boolean(event.metadata),
  );
  return {
    case: {
      id: requestCase.id,
      type: requestCase.type,
      status: requestCase.status,
      version: requestCase.version,
      submittedAt: requestCase.submittedAt,
      approvedAt: requestCase.approvedAt,
      rejectedAt: requestCase.rejectedAt,
      completedAt: requestCase.completedAt,
      closedAt: requestCase.closedAt,
    },
    timeline: requestCase.events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      actorRole: event.actorRoleSnapshot,
      createdAt: event.createdAt,
    })),
    requirements: requestCase.requirements.map((requirement) => ({
      id: requirement.id,
      type: requirement.type,
      status: requirement.status,
      title: requirement.title,
      instructions: requirement.instructions,
      documentLabels: requirement.documentLabels,
      dueAt: requirement.dueAt,
      payment: requirement.paymentCharge,
      assets: requirement.assets.map(({ label, asset }) => ({ label, ...asset })),
    })),
    deliverables: requestCase.assets.map(({ label, asset }) => ({ label, ...asset })),
    availableActions: availableCaseActions({
      status: requestCase.status,
      openRequirements: requestCase._count.requirements,
      hasCompletionRecord,
    }, caseActor),
  };
};
