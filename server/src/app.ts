import cookieParser from "cookie-parser";
import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import { configCors } from "./config/cors";
import { prisma } from "./config/db";
import applicationRouter from "./routes/application.route";
import authRouter from "./routes/auth.route";
import certRouter from "./routes/certificate.routes";
import coAdminRouter from "./routes/coAdmin.route";
import dashboardRouter from "./routes/dashboard.route";
import documentRouter from "./routes/document.route";
import mailRouter from "./routes/mail.route";
import mediaRouter from "./routes/media.route";
import notificationRouter from "./routes/notification.route";
import paymentRouter from "./modules/payments/payment.route";
import razorpayWebhookRouter from "./modules/payments/razorpayWebhook.route";
import planRouter from "./routes/plan.route";
import queryRouter from "./routes/query.route";
import serviceRouter from "./routes/service.route";
import userRouter from "./routes/user.route";
import { requestLogger } from "./utils/logger";
import caseRouter from "./modules/cases/case.route";

interface AppDependencies {
  readinessProbe(): Promise<void>;
}

const defaultDependencies: AppDependencies = {
  async readinessProbe() {
    await prisma.$queryRaw`SELECT 1`;
  },
};

export const createApp = (overrides: Partial<AppDependencies> = {}): Express => {
  const dependencies = { ...defaultDependencies, ...overrides };
  const app = express();
  app.set("trust proxy", 1);
  app.use(requestLogger);
  app.use("/api/v1/payments/webhooks/razorpay", razorpayWebhookRouter);
  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({ status: "healthy" });
  });
  app.get("/ready", async (_request: Request, response: Response) => {
    try {
      await dependencies.readinessProbe();
      response.status(200).json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });
  app.use(helmet());
  app.use(configCors());
  app.use(cookieParser());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/admin/coadmins", coAdminRouter);
  app.use("/api/v1/application", applicationRouter);
  app.use("/api/v1/notification", notificationRouter);
  app.use("/api/v1/service", serviceRouter);
  app.use("/api/v1/user", userRouter);
  app.use("/api/v1/query", queryRouter);
  app.use("/api/v1/payments", paymentRouter);
  app.use("/api/v1/cases", caseRouter);
  app.use("/api/v1/mail", mailRouter);
  app.use("/api/v1/media", mediaRouter);
  app.use("/api/v1/plan", planRouter);
  app.use("/api/v1/document", documentRouter);
  app.use("/api/v1/certificate", certRouter);
  app.use("/api/v1/analytics", dashboardRouter);
  app.get("/api/appCheck", (_request: Request, response: Response) => {
    response.status(200).json({ status: "healthy", timestamp: new Date().toISOString(), message: "Service is running" });
  });
  app.get("/api/dbCheck", async (_request: Request, response: Response) => {
    try {
      await dependencies.readinessProbe();
      response.status(200).json({ status: "connected", message: "Database is reachable", timestamp: new Date().toISOString() });
    } catch {
      response.status(500).json({ status: "disconnected", message: "Failed to connect to the database", timestamp: new Date().toISOString() });
    }
  });
  return app;
};
