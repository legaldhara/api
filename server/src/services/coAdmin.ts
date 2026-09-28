import { randomBytes } from "crypto";
import { prisma } from "../config/db";
import MailService from "./Mail";
import { AdminIdentityProvider, adminIdentity } from "./adminIdentity";

export type InvitationStatus = "PENDING" | "SENT" | "FAILED";

export interface CoAdminRecord {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  role: "COADMIN";
  isActive: boolean;
}

export interface CoAdminRepository {
  findByEmail(email: string): Promise<{ id: string } | null>;
  create(input: { uid: string; email: string; fullName: string }): Promise<CoAdminRecord>;
  setInvitationStatus(userId: string, status: "SENT" | "FAILED"): Promise<void>;
}

interface InvitationMailer {
  sendInvitation(input: { email: string; fullName: string; setupLink: string }): Promise<void>;
}

export class CoAdminError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const repository: CoAdminRepository = {
  findByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },
  async create(input) {
    return prisma.user.create({
      data: {
        uid: input.uid,
        email: input.email,
        phone: null,
        fullName: input.fullName,
        role: "COADMIN",
        isActive: true,
        emailVerified: true,
        adminInvitation: { create: { deliveryStatus: "PENDING" } },
      },
      select: { id: true, uid: true, email: true, fullName: true, role: true, isActive: true },
    }) as Promise<CoAdminRecord>;
  },
  async setInvitationStatus(userId, status) {
    const now = new Date();
    await prisma.adminInvitation.update({
      where: { userId },
      data: {
        deliveryStatus: status,
        ...(status === "SENT" ? { lastSentAt: now } : { lastErrorAt: now }),
      },
    });
  },
};

const invitationMailer: InvitationMailer = {
  async sendInvitation(input) {
    await MailService.send(
      input.email,
      "Set up your LegalDhara co-admin account",
      `Hello ${input.fullName}, set your password using this secure link: ${input.setupLink}`,
      "support",
      `<p>Hello ${input.fullName},</p><p>You have been invited as a LegalDhara co-admin.</p><p><a href="${input.setupLink}">Set your password</a></p>`,
    );
  },
};

interface InviteDependencies {
  repository: CoAdminRepository;
  identity: AdminIdentityProvider;
  mail: InvitationMailer;
  randomPassword: () => string;
}

const inviteDependencies = (overrides: Partial<InviteDependencies> = {}): InviteDependencies => ({
  repository,
  identity: adminIdentity,
  mail: invitationMailer,
  randomPassword: () => randomBytes(48).toString("base64url"),
  ...overrides,
});

export const inviteCoAdmin = async (
  input: { fullName: string; email: string },
  overrides: Partial<InviteDependencies> = {},
): Promise<CoAdminRecord & { invitationStatus: InvitationStatus }> => {
  const deps = inviteDependencies(overrides);
  const email = input.email.trim().toLowerCase();
  const [localConflict, identityConflict] = await Promise.all([
    deps.repository.findByEmail(email),
    deps.identity.findByEmail(email),
  ]);
  if (localConflict || identityConflict) throw new CoAdminError("An account already uses this email", 409);

  const identity = await deps.identity.create({ email, password: deps.randomPassword() });
  let coadmin: CoAdminRecord;
  try {
    coadmin = await deps.repository.create({ uid: identity.uid, email, fullName: input.fullName.trim() });
  } catch (error) {
    await deps.identity.remove(identity.uid).catch(() => undefined);
    throw error;
  }

  try {
    const setupLink = await deps.identity.createPasswordSetupLink(email);
    await deps.mail.sendInvitation({ email, fullName: coadmin.fullName, setupLink });
    await deps.repository.setInvitationStatus(coadmin.id, "SENT");
    return { ...coadmin, invitationStatus: "SENT" };
  } catch {
    await deps.repository.setInvitationStatus(coadmin.id, "FAILED");
    return { ...coadmin, invitationStatus: "FAILED" };
  }
};

export const listCoAdmins = async (input: { page: number; limit: number; search?: string }) => {
  const where = {
    role: "COADMIN" as const,
    ...(input.search ? { OR: [
      { fullName: { contains: input.search, mode: "insensitive" as const } },
      { email: { contains: input.search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fullName: true, email: true, isActive: true, createdAt: true, lastLogin: true,
        adminSecurity: { select: { enabledAt: true } },
        adminInvitation: { select: { deliveryStatus: true, lastSentAt: true, lastErrorAt: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { items: items.map(({ adminSecurity, ...item }) => ({ ...item, mfaEnrolled: Boolean(adminSecurity?.enabledAt) })), total };
};

export const resendCoAdminInvitation = async (userId: string): Promise<{ invitationStatus: "SENT" | "FAILED" }> => {
  const user = await prisma.user.findFirst({ where: { id: userId, role: "COADMIN" }, select: { id: true, email: true, fullName: true } });
  if (!user) throw new CoAdminError("Co-admin not found", 404);
  try {
    const setupLink = await adminIdentity.createPasswordSetupLink(user.email);
    await invitationMailer.sendInvitation({ email: user.email, fullName: user.fullName, setupLink });
    await repository.setInvitationStatus(user.id, "SENT");
    return { invitationStatus: "SENT" };
  } catch {
    await repository.setInvitationStatus(user.id, "FAILED");
    return { invitationStatus: "FAILED" };
  }
};

export const setCoAdminActive = async (input: { actorId: string; userId: string; active: boolean }) => {
  if (input.actorId === input.userId) throw new CoAdminError("You cannot change your own administrative status", 400);
  const target = await prisma.user.findFirst({ where: { id: input.userId, role: "COADMIN" }, select: { id: true, uid: true, isActive: true } });
  if (!target?.uid) throw new CoAdminError("Co-admin not found", 404);
  await adminIdentity.setDisabled(target.uid, !input.active);
  try {
    return await prisma.user.update({ where: { id: target.id }, data: { isActive: input.active }, select: { id: true, isActive: true } });
  } catch (error) {
    await adminIdentity.setDisabled(target.uid, !target.isActive).catch(() => undefined);
    throw error;
  }
};