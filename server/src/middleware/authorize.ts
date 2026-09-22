// middleware/authorize.ts
import { Request, Response, NextFunction } from "express";
import { AuthRequest, role } from "../types/custom";

/**
 * Middleware to check if the authenticated user has one of the allowed roles.
 * @param roles List of allowed roles
 */

export const authorize = (...roles: role[]) => (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as AuthRequest).auth?.role;
    
    if (!userRole) {
        res.status(403).json({ success: false, error: "Access Denied: No role found" });
        return;
    }

    if (!roles.includes(userRole as role)) {
        res.status(403).json({ success: false, error: "Access Denied: Insufficient role" });
        return;
    }

    next();
};
