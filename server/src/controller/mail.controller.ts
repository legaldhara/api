import { Request, Response } from "express";
import MailService from "../services/Mail";
import { consumeRateLimit } from "../services/rateLimiter";
import { AuthRequest } from "../types/custom";
import { receiveMailQuerySchema, sendMailSchema } from "../zodSchema/mail.schema";

export const sendMailController = async (req: Request, res: Response) => {
  const parse = sendMailSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ message: "Invalid request body", details: parse.error });
  }

  const { to, subject, text, html, aliasFrom } = parse.data;
  try {
    const auth = (req as AuthRequest).auth;
    const rateLimit = await consumeRateLimit({
      scope: "admin-mail-send",
      key: `${auth.id}:${req.ip || "unknown"}`,
      limit: 20,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return res.status(429).json({ success: false, error: "Mail send limit exceeded" });
    }

    await MailService.send(to, subject, text || "", aliasFrom, html);
    return res.status(200).json({ message: "Mail sent successfully" });
  } catch (error) {
    console.error("Send mail error:", error);
    return res.status(502).json({ error: "Failed to send mail" });
  }
};

export const receiveMailController = async (req: Request, res: Response) => {
  const parsed = receiveMailQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query" });

  try {
    const emails = await MailService.receive(parsed.data.limit);
    return res.status(200).json({ emails });
  } catch (error) {
    console.error("Receive mail error:", error);
    return res.status(502).json({ error: "Failed to receive mails" });
  }
};