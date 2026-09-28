import nodemailer, { Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
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
      throw error;
    }
  };

  async receive(limit: number = 10): Promise<any[]> {
    const client = new ImapFlow({
      host: process.env.IMAP_HOST || "imap.hostinger.com",
      port: Number(process.env.IMAP_PORT) || 993,
      secure: true,
      auth: {
        user: process.env.MAIL_USER!,
        pass: process.env.MAIL_PASS!,
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const total = client.mailbox ? client.mailbox.exists : 0;
        if (total === 0) return [];

        const start = Math.max(1, total - limit + 1);
        const emails = [];
        for await (const message of client.fetch(`${start}:*`, { source: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          emails.push({
            from: parsed.from?.text,
            subject: parsed.subject,
            date: parsed.date,
            text: parsed.text,
            html: parsed.html,
          });
        }
        return emails;
      } finally {
        lock.release();
      }
    } catch (error) {
      console.error("Error fetching emails:", error);
      return [];
    } finally {
      if (client.usable) await client.logout();
    }
  }

}

export default new MailService();
