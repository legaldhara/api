import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../types/custom";
import { verifyMfaProof } from "../services/adminMfa";

export const requireAdminMfa = (request: Request, response: Response, next: NextFunction): void => {
  const auth = (request as AuthRequest).auth;
  if (!auth || !verifyMfaProof(request.cookies?.["__Host-admin_mfa"] || "", auth.uid)) {
    response.status(403).json({ success: false, error: "MFA verification required" }); return;
  }
  next();
};
