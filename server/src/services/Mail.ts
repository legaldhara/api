import nodemailer, { Transporter } from "nodemailer";
import * as imaps from "imap-simple";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import { ImapSimple, Message } from "imap-simple";
import { logger } from "../utils/logger";

dotenv.config();

class MailService {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: true,
      auth: {
        user: process.env.MAIL_USER, // admin@yourdomain.com
        pass: process.env.MAIL_PASS,
      },
    });

    this.transporter.verify((error, success) => {
      if (error) {
        logger.error("[Mail] SMTP connection failed:", error);
      } else {
        console.info("[Mail] SMTP connection successful");
      }
    });
  }

  async send(
    to: string | string[],
    subject: string,
    text: string,
    aliasFrom?: "info" | "support" | "contact",
    html?: string,
  ): Promise<void> {
    try {
      const aliasMap: Record<string, string> = {
        info: "info@legaldhara.com",
        support: "support@legaldhara.com",
        contact: "contact@legaldhara.com",
      };

      const fromEmail = aliasFrom ? aliasMap[aliasFrom] : process.env.MAIL_FROM;

      await this.transporter.sendMail({
        from: fromEmail,
        to: Array.isArray(to) ? to.join(",") : to,
        subject,
        text,
        html,
      });

      console.log(`Mail sent from ${fromEmail} to ${to}`);
    } catch (error) {
      logger.error("Error sending mail:", error);
    }
  };

  async receive(limit: number = 10): Promise<any[]> {
    const config = {
      imap: {
        user: process.env.MAIL_USER!,
        password: process.env.MAIL_PASS!,
        host: process.env.IMAP_HOST || "imap.hostinger.com",
        port: Number(process.env.IMAP_PORT) || 993,
        tls: true,
        authTimeout: 5000,
      },
    };

    try {
      const connection: ImapSimple = await imaps.connect(config);
      await connection.openBox("INBOX");

      const searchCriteria = ["ALL"];
      const fetchOptions = {
        bodies: [""],
        markSeen: false,
      };
 
      const messages: Message[] = await connection.search(searchCriteria, fetchOptions);
      const latest = messages.slice(-limit);

      const emails = await Promise.all(
        latest.map(async (item) => {
          const part = item.parts.find((part) => part.which === "");
          if (!part || !part.body) return null;

          const parsed = await simpleParser(part.body);

          return {
            from: parsed.from?.text,
            subject: parsed.subject,
            date: parsed.date,
            text: parsed.text,
            html: parsed.html,
          };
        })
      );

      await connection.end();
      return emails.filter(Boolean);
    } catch (error) {
      console.error("Error fetching emails:", error);
      return [];
    }
  }

}

export default new MailService();
