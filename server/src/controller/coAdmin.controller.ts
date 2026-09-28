import { Request, Response } from "express";
import { CoAdminError, inviteCoAdmin, listCoAdmins, resendCoAdminInvitation, setCoAdminActive } from "../services/coAdmin";
import { AuthRequest } from "../types/custom";
import { coAdminListQuerySchema, coAdminStatusSchema, inviteCoAdminSchema } from "../zodSchema/coAdmin.schema";

const sendError = (response: Response, error: unknown): Response => {
  if (error instanceof CoAdminError) return response.status(error.statusCode).json({ success: false, error: error.message });
  return response.status(500).json({ success: false, error: "Unable to manage co-admin account" });
};

export const inviteCoAdminController = async (request: Request, response: Response) => {
  const parsed = inviteCoAdminSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid invitation" });
  try {
    return response.status(201).json({ success: true, data: await inviteCoAdmin(parsed.data) });
  } catch (error) { return sendError(response, error); }
};

export const listCoAdminsController = async (request: Request, response: Response) => {
  const parsed = coAdminListQuerySchema.safeParse(request.query);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid query" });
  try {
    const result = await listCoAdmins(parsed.data);
    return response.json({ success: true, data: result.items, pagination: { page: parsed.data.page, limit: parsed.data.limit, total: result.total } });
  } catch (error) { return sendError(response, error); }
};

export const resendCoAdminInvitationController = async (request: Request, response: Response) => {
  try { return response.json({ success: true, data: await resendCoAdminInvitation(request.params.id) }); }
  catch (error) { return sendError(response, error); }
};

export const setCoAdminStatusController = async (request: Request, response: Response) => {
  const parsed = coAdminStatusSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, error: "Invalid status" });
  try {
    const actor = (request as AuthRequest).auth;
    return response.json({ success: true, data: await setCoAdminActive({ actorId: actor.id, userId: request.params.id, active: parsed.data.active }) });
  } catch (error) { return sendError(response, error); }
};