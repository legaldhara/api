// middleware/authMiddleware.ts
import { Request, Response, NextFunction } from "express";
import JWT from "jsonwebtoken";
import { decryptRSA } from "../config/encryption";
import { AuthPayload, AuthRequest } from "../types/custom";

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.idToken;

  if (!token) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  try {
    const decoded = JWT.verify(token, process.env.JWT_SECRET!) as { data: string };
    
    if (!decoded?.data) {
      res.status(401).json({ success: false, error: "Invalid token payload" });
      return;
    }

    const decrypted = decryptRSA(decoded.data);
    const user: AuthPayload = decrypted;

    (req as AuthRequest).auth = {
      ...((req as AuthRequest).auth || {}),
      ...user,
    };

    next();
  } catch (err: any) {
     if (err.name === "TokenExpiredError") {
      res.status(401).json({ success: false, error: "Session expired. Please login again." });
      return;
    }
    console.error("Auth error:", err.message);
    res.status(401).json({ success: false, error: "Invalid or expired token" });
    return;

  }
};
