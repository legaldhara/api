import { createAdminFromFirebaseUser } from './controller/auth.controller';
import 'dotenv/config';
// import './cron/expirePayment';
// import './cron/backup';
import { prisma } from './config/db';
import express, { Express, Request, Response } from "express";
import cookieParser from "cookie-parser";
import PhonePeRoutes from './routes/phonepe.route'
import helmet from 'helmet';
import { configCors } from './config/cors';
import { requestLogger } from './utils/logger';
import authRouter from './routes/auth.route';
import applicationRouter from './routes/application.route';
import serviceRouter from './routes/service.route';
import userRouter from './routes/user.route';
import queryRouter from './routes/query.route';
import notificationRouter from './routes/notification.route';
import paymentRouter from './routes/payment.route';
import mailRouter from './routes/mail.route';
import documentRouter from './routes/document.route';
import certRouter from './routes/certificate.routes';
import mediaRouter from './routes/media.route';
import planRouter from './routes/plan.route';
import dashboardRouter from './routes/dashboard.route';
import http from 'http';
import { Server } from "socket.io";


const PORT = process.env.PORT || 4001;

const APP: Express = express();

// For Admin Creation
// (async () => {
//     await createAdminFromFirebaseUser();
//     })()
//   main()
//     .then(() => {
//           console.log('Seeding complete.');
//   return prisma.$disconnect();
// })
// .catch(e => {
//   console.error(e);
//   return prisma.$disconnect();
// });

//Create a http server Wrapper for Socket.io
const server = http.createServer(APP);

// ----- Socket.io intialize -----
export const io = new Server(server, {
  cors: {
    origin: [
      // "http://localhost:4001",
      "https://www.legaldhara.com",
      "https://legaldhara.com",
      "https://www.legaldhara.in",
      "https://legaldhara.in"
    ], // set your frontend domain here
    methods: ["GET", "POST"]
  }
})


io.on('connection', (socket) => {
  console.log(socket.id, "[Socket Connected]");

  socket.on('join-admins', () => {
    socket.join('ADMINS');
    console.log(socket.id, "[Joined ADMINS]");
  });

  socket.on('disconnect', () => {
    console.log(socket.id, "[Socket Disconnected]");
  });
});

APP.use(requestLogger)

APP.use('/api/v1', PhonePeRoutes);

APP.use(helmet());
APP.use(configCors());
APP.use(cookieParser());

APP.use(express.json({ limit: "10mb" }));
APP.use(express.urlencoded({ extended: true }));


APP.use("/api/v1/auth", authRouter);
APP.use("/api/v1/application", applicationRouter);
APP.use("/api/v1/notification", notificationRouter);
APP.use("/api/v1/service", serviceRouter);
APP.use("/api/v1/user", userRouter);
APP.use("/api/v1/query", queryRouter);
APP.use("/api/v1/payment", paymentRouter);
APP.use("/api/v1/mail", mailRouter);
APP.use("/api/v1/media", mediaRouter);
APP.use("/api/v1/plan", planRouter);
APP.use("/api/v1/document", documentRouter);
APP.use("/api/v1/certificate", certRouter);

APP.use("/api/v1/analytics", dashboardRouter);

APP.get('/api/appCheck', async (req: Request, res: any) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Service is running'
  });
});


APP.get('/api/dbCheck', async (req: Request, res: Response) => {
  try {
    // Simple query to check connection (no actual data needed)
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "connected",
      message: "Database is reachable",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[DB ERROR]", error);
    res.status(500).json({
      status: "disconnected",
      message: "Failed to connect to the database",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
});

server.listen(PORT, () => {
  console.log(`[Server] Server + Socket.IO running on ${PORT}`);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  console.log("[Prisma] Disconnected Prisma gracefully");
  process.exit(0);
});
