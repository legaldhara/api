import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { prisma } from "./config/db";
import { setIo } from "./socket";
import { configCorsOrigins } from "./config/cors";
import { verifyFirebaseIdToken } from "./config/firebase";
import { verifyMfaProof } from "./services/adminMfa";
import { startPaymentReconciliationJob, stopPaymentReconciliationJob } from "./modules/payments/reconciliationJob";

export const startServer = async (): Promise<http.Server> => {
  const server = http.createServer(createApp());
  const io = new Server(server, { cors: { origin: configCorsOrigins(), methods: ["GET", "POST"], credentials: true } });
  setIo(io);
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const decoded = await verifyFirebaseIdToken(token, true);
      const user = await prisma.user.findUnique({ where: { uid: decoded.uid } });
      const cookies = Object.fromEntries((socket.handshake.headers.cookie || "").split(";").filter(Boolean).map((entry) => entry.trim().split("=").map(decodeURIComponent)));
      if (!user?.isActive || !["ADMIN", "COADMIN"].includes(user.role) || !verifyMfaProof(cookies["__Host-admin_mfa"] || "", decoded.uid)) throw new Error("Unauthorized");
      socket.data.user = user; next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", (socket) => { void socket.join("ADMINS"); });
  startPaymentReconciliationJob();
  await new Promise<void>((resolve) => server.listen(Number(process.env.PORT || 4001), resolve));
  return server;
};

export const stopServer = async (server: http.Server): Promise<void> => {
  stopPaymentReconciliationJob();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
};
