import { Request, Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../types/custom";
import { confirmEnrollment, consumeRecoveryCode, createEnrollment, createMfaProof, verifyMfa } from "../services/adminMfa";
import { isAdminMfaBypassEnabled } from "../config/adminMfaBypass";

const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/", maxAge: 28_800_000 };
const attempts = new Map<string, { count: number; resetAt: number }>();
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(100).optional(),
}).strict().refine((value) => Boolean(value.code || value.recoveryCode));

export const enrollMfa = async (request: Request, response: Response) =>
  response.json({ success: true, enrollment: await createEnrollment((request as AuthRequest).auth.id) });

export const confirmMfa = async (request: Request, response: Response) => {
  const parsed = codeSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid verification code" });
  const auth = (request as AuthRequest).auth;
  try {
    const recoveryCodes = await confirmEnrollment(auth.id, parsed.data.code);
    return response.cookie("__Host-admin_mfa", createMfaProof(auth.uid), cookieOptions)
      .json({ success: true, recoveryCodes });
  } catch {
    return response.status(401).json({ success: false, error: "Invalid verification code" });
  }
};

export const verifyAdminMfa = async (request: Request, response: Response) => {
  const parsed = verifySchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid verification request" });
  const auth = (request as AuthRequest).auth;
  const key = `${auth.uid}:${request.ip}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 5) {
    return response.status(429).json({ success: false, error: "Too many attempts" });
  }
  const valid = parsed.data.code
    ? await verifyMfa(auth.id, parsed.data.code)
    : await consumeRecoveryCode(auth.id, parsed.data.recoveryCode || "");
  if (!valid) {
    attempts.set(key, { count: current && current.resetAt > now ? current.count + 1 : 1, resetAt: now + 300_000 });
    return response.status(401).json({ success: false, error: "Invalid verification code" });
  }
  attempts.delete(key);
  return response.cookie("__Host-admin_mfa", createMfaProof(auth.uid), cookieOptions).json({ success: true });
};

export const skipAdminMfaForDevelopment = async (request: Request, response: Response) => {
  if (!isAdminMfaBypassEnabled()) {
    return response.status(404).json({ success: false, error: "Not found" });
  }
  const auth = (request as AuthRequest).auth;
  return response.cookie("__Host-admin_mfa", createMfaProof(auth.uid), cookieOptions).json({ success: true });
};

export const clearAdminMfa = async (_request: Request, response: Response) =>
  response.clearCookie("__Host-admin_mfa", cookieOptions).status(204).end();
