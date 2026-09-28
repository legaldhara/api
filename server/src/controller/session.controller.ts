import { Request, Response } from "express";
import { prisma } from "../config/db";
import { verifyMfaProof } from "../services/adminMfa";
import { AuthRequest } from "../types/custom";
import { isAdminMfaBypassEnabled } from "../config/adminMfaBypass";

export const getSession = async (request: Request, response: Response): Promise<void> => {
  const auth = (request as AuthRequest).auth;
  const administrative = auth.role === "ADMIN" || auth.role === "COADMIN";
  if (!administrative) {
    response.status(200).json({ success: true, user: auth, mfaEnrolled: true, mfaVerified: true });
    return;
  }

  const security = await prisma.adminSecurity.findUnique({
    where: { userId: auth.id },
    select: { enabledAt: true },
  });
  const mfaEnrolled = Boolean(security?.enabledAt);
  const mfaVerified = (mfaEnrolled || isAdminMfaBypassEnabled())
    && verifyMfaProof(request.cookies?.["__Host-admin_mfa"] || "", auth.uid);
  response.status(200).json({ success: true, user: auth, mfaEnrolled, mfaVerified });
};
