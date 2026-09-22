import cron from "node-cron";
import { PaymentStatus } from "@prisma/client";
import { logger } from "../utils/logger";
import PhonePe from "../services/PhonePe"; // adjust import path
import { prisma } from "../config/db";

// Run every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

  logger.info("⏰ Payment expiry cron running...");

  try {
    // 1️⃣ Find all pending payments older than 15 mins or past expiry
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        OR: [
          { expiresAt: { lt: now } },
          { paymentDate: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        transactionId: true,
      },
    });

    if (pendingPayments.length === 0) {
      logger.info("✅ No pending payments to verify.");
      return;
    }

    let expiredCount = 0;

    for (const payment of pendingPayments) {
      try {
        const res = await PhonePe.checkOrderStatus(payment.transactionId);
        const state = res?.state;
        logger.info(`🔍 Payment ${payment.transactionId} status from PhonePe: ${state}`);

        // Only mark as expired if PhonePe says PENDING
        if (state === 'FAILED') {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.EXPIRED },
          });
          expiredCount++;
        }
      } catch (err) {
        logger.error(`❌ Failed to check status for ${payment.transactionId}:`, err);
      }
    }

    if (expiredCount > 0) {
      logger.info(`⏰ Marked ${expiredCount} payments as EXPIRED (PhonePe FAILED state)`);
    } else {
      logger.info("✅ No failed payments found to expire");
    }
    
    logger.info("✅ Payment expiry cron finished.");
  } catch (err) {
    logger.error("❌ Cron job failed to process payments:", err);
  }
});
