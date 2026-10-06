import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db";
import { prismaCaseRepository } from "./repository";
import { createCaseService } from "./service";
import type { CaseActor } from "./types";

export const caseService = createCaseService(prismaCaseRepository);

export const createCaseFixtures = () => {
  const suffix = randomUUID();
  const createdUserIds: string[] = [];
  const createdServiceIds: string[] = [];

  const createActor = async (role: "USER" | "COADMIN" | "ADMIN"): Promise<CaseActor> => {
    const user = await prisma.user.create({
      data: {
        uid: `${role.toLowerCase()}-${suffix}-${createdUserIds.length}`,
        fullName: `${role} Integration`,
        email: `${role.toLowerCase()}-${suffix}-${createdUserIds.length}@example.com`,
        role,
        isActive: true,
        emailVerified: true,
      },
    });
    createdUserIds.push(user.id);
    return { id: user.id, role, ownsCase: role === "USER", mfaVerified: role !== "USER" };
  };

  const createRequest = async (type: "APPLICATION" | "CERTIFICATE", owner: CaseActor) => {
    if (type === "APPLICATION") {
      const service = await prisma.service.create({
        data: { name: `Integration ${suffix}`, price: 100, deliverables: [], docRequired: [] },
      });
      createdServiceIds.push(service.id);
      const application = await prisma.application.create({
        data: { ticketNo: `APL-${suffix}`, userId: owner.id, serviceId: service.id },
      });
      return caseService.createCase({
        type,
        ownerId: owner.id,
        applicationId: application.id,
        idempotencyKey: `create-${suffix}`,
      });
    }
    const certificate = await prisma.certificateRequest.create({
      data: {
        requestNo: `CER-${suffix}`,
        userId: owner.id,
        subject: "Integration certificate",
      },
    });
    return caseService.createCase({
      type,
      ownerId: owner.id,
      certificateRequestId: certificate.id,
      idempotencyKey: `create-${suffix}`,
    });
  };

  const createAsset = async (ownerId: string, name: string) => prisma.uploadedAsset.create({
    data: {
      ownerId,
      publicId: `integration/${suffix}/${name}`,
      secureUrl: `https://cdn.example.com/${suffix}/${name}`,
      resourceType: "raw",
      mimeType: "application/pdf",
      originalName: `${name}.pdf`,
      sizeBytes: 1_024,
    },
  });

  const cleanup = async () => {
    await prisma.notificationOutbox.deleteMany({ where: { recipientId: { in: createdUserIds } } });
    await prisma.notificationRead.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.notification.deleteMany({ where: { caseEvent: { requestCase: { ownerId: { in: createdUserIds } } } } });
    await prisma.caseAsset.deleteMany({ where: { requestCase: { ownerId: { in: createdUserIds } } } });
    await prisma.caseEvent.deleteMany({ where: { requestCase: { ownerId: { in: createdUserIds } } } });
    await prisma.caseRequirement.deleteMany({ where: { requestCase: { ownerId: { in: createdUserIds } } } });
    await prisma.requestCase.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.paymentAttempt.deleteMany({ where: { charge: { userId: { in: createdUserIds } } } });
    await prisma.paymentCharge.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.application.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.certificateRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.uploadedAsset.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
  };

  return { suffix, createActor, createRequest, createAsset, cleanup };
};
