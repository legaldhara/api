import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/db";
import { verifyFirebaseIdToken } from "../config/firebase";
import { AuthRequest, FirebaseIdentityRequest } from "../types/custom";


export const authenticateFirebaseIdentity = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  try {
    const decoded = await verifyFirebaseIdToken(authorization.slice(7), true);
    (request as FirebaseIdentityRequest).firebaseIdentity = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
    };
    next();
  } catch {
    response.status(401).json({ success: false, error: "Authentication required" });
  }
};
export const authenticate = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  try {
    const decoded = await verifyFirebaseIdToken(authorization.slice(7), true);
    const user = await prisma.user.findUnique({
      where: { uid: decoded.uid },
      select: { id: true, uid: true, fullName: true, email: true, phone: true, role: true, isActive: true },
    });
    if (!user) {
      response.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    if (!user.isActive) {
      response.status(403).json({ success: false, error: "Account disabled" });
      return;
    }
    if (user.role === "USER" && decoded.email_verified !== true) {
      response.status(403).json({ success: false, error: "Verification required" });
      return;
    }
    (request as AuthRequest).auth = { id: user.id, uid: decoded.uid, role: user.role, email: user.email, phone: user.phone, name: user.fullName };
    next();
  } catch {
    response.status(401).json({ success: false, error: "Authentication required" });
  }
};
