// src/controllers/mail.controller.ts
import { Request, Response } from "express";
import MailService from "../services/Mail";
import { z } from "zod";
import { sendMailSchema } from "../zodSchema/mail.schema";

export const sendMailController = async (req: Request, res: Response) => {

    const parse = sendMailSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({
            message: "Invalid request body",
            details: parse.error
        });
    }

    const { to, subject, text, html, aliasFrom } = parse.data;

    try {
        await MailService.send(to, subject, text || "", aliasFrom,  html,);
        return res.status(200).json({ message: "Mail sent successfully" });
    } catch (error) {
        console.error("Send mail error:", error);
        return res.status(500).json({ error: "Failed to send mail" });
    }
};

export const receiveMailController = async (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    try {
        const emails = await MailService.receive(limit);
        return res.status(200).json({ emails });
    } catch (error) {
        console.error("Receive mail error:", error);
        return res.status(500).json({ error: "Failed to receive mails" });
    }
};

