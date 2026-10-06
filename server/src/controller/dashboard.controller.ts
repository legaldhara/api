// 

import { Request, Response } from "express";
import { prisma } from "../config/db";
import dayjs from "dayjs";
import { startOfYear, endOfYear } from "date-fns";

/**
 * 🧾 1. USER SUMMARY
 * Total users, new users today/month, by roles, and login activity
 */
export const getUserAnalyticsSummary = async (req: Request, res: Response) => {
  try {
    const startOfToday = dayjs().startOf("day").toDate();
    const startOfYesterday = dayjs().subtract(1, "day").startOf("day").toDate();
    const startOfMonth = dayjs().startOf("month").toDate();
    const startOfLastMonth = dayjs().subtract(1, "month").startOf("month").toDate();
    const endOfLastMonth = dayjs().subtract(1, "month").endOf("month").toDate();

    // Parallel queries
    const [
      totalUsers,
      totalAdmins,
      totalCoadmins,
      newToday,
      newYesterday,
      newThisMonth,
      newLastMonth,
      activeUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.user.count({ where: { role: "COADMIN" } }),
      prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.user.count({
        where: {
          createdAt: { gte: startOfYesterday, lt: startOfToday },
        },
      }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.user.count({
        where: { createdAt: { gte: startOfLastMonth, lt: endOfLastMonth } },
      }),
      prisma.user.count({ where: { lastLogin: { gte: startOfMonth } } }),
    ]);

    // ✅ Percent change calculation
    const dailyPercent =
      newYesterday === 0 ? 100 : ((newToday - newYesterday) / newYesterday) * 100;

    const monthlyPercent =
      newLastMonth === 0 ? 100 : ((newThisMonth - newLastMonth) / newLastMonth) * 100;

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalCoadmins,
        newToday,
        newThisMonth,
        activeUsers,
        percent: {
          daily: dailyPercent,
          monthly: monthlyPercent,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching user analytics:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch user analytics" });
  }
};


/**
 * 📈 2. MONTHLY USER REGISTRATION TREND
 */
export const getMonthlyUserRegistration = async (req: Request, res: Response) => {
  try {
    const data = await prisma.$queryRaw<{ month: string; count: bigint }[]>`
      SELECT TO_CHAR("createdAt", 'YYYY-MM') AS month, COUNT(*) AS count
      FROM "User"
      GROUP BY month ORDER BY month ASC;
    `;

    const formatted = data.map((item) => ({
      month: item.month,
      count: Number(item.count),
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Error fetching monthly user registrations:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch user registration trend" });
  }
};

/**
 * 🧮 3. APPLICATION STATUS DISTRIBUTION
 */
export const getApplicationCountByStatus = async (req: Request, res: Response) => {
  try {
    const statusCounts = await prisma.requestCase.groupBy({
      by: ["status"],
      where: { applicationId: { not: null } },
      _count: { status: true },
    });

    const formatted = Object.fromEntries(
      statusCounts.map((item) => [item.status, item._count.status])
    );

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Error fetching app status count:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 🧰 4. APPLICATION COUNT BY SERVICE
 */
export const getApplicationCountByService = async (req: Request, res: Response) => {
  try {
    const grouped = await prisma.application.groupBy({
      by: ["serviceId"],
      _count: { serviceId: true },
    });

    const services = await prisma.service.findMany({
      where: { id: { in: grouped.map((g) => g.serviceId) } },
      select: { id: true, name: true },
    });

    const result = grouped.map((g) => ({
      serviceName: services.find((s) => s.id === g.serviceId)?.name || "Unknown",
      count: g._count.serviceId,
    }));

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching service-based count:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 📅 5. APPLICATION TREND BY MONTH (per year)
 */
export const getApplicationTrendByMonth = async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const startDate = startOfYear(new Date(year, 0));
    const endDate = endOfYear(new Date(year, 11));

    const raw = await prisma.$queryRaw<{ month: number; count: bigint }[]>`
      SELECT EXTRACT(MONTH FROM "createdAt") AS month, COUNT(*) AS count
      FROM "Application"
      WHERE "createdAt" BETWEEN ${startDate} AND ${endDate}
      GROUP BY month ORDER BY month;
    `;

    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    const values = Array(12).fill(0);
    raw.forEach((r) => (values[r.month - 1] = Number(r.count)));

    return res.status(200).json({
      success: true,
      data: { labels: months, values },
    });
  } catch (error) {
    console.error("Error fetching application trend:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 💰 6. PAYMENT SUMMARY (Success/Failed/Pending/Expired)
 */
export const getPaymentSummary = async (req: Request, res: Response) => {
  try {
    const total = await prisma.paymentAttempt.count();

    const statusCounts = await prisma.paymentAttempt.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const counts: Record<string, number> = {
      SUCCESS: 0,
      FAILED: 0,
      PENDING: 0,
      EXPIRED: 0,
    };

    statusCounts.forEach((s) => (counts[s.status] = s._count.status));

    const successfulPayments = await prisma.paymentCharge.findMany({
      where: { status: "PAID" },
      select: { amountMinor: true },
    });

    const totalRevenue = successfulPayments.reduce(
      (sum, payment) => sum + payment.amountMinor / 100,
      0
    );

    return res.status(200).json({
      success: true,
      data: { totalPayments: total, totalRevenue, statusBreakdown: counts },
    });
  } catch (error) {
    console.error("Error fetching payment summary:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 🪙 7. PAYMENT BREAKDOWN BY TYPE
 */
export const getRevenueAndCountByPaymentType = async (req: Request, res: Response) => {
  try {
    const grouped = await prisma.paymentCharge.groupBy({
      by: ["category"],
      where: { status: "PAID" },
      _count: { category: true },
      _sum: { amountMinor: true },
    });

    const formatted = grouped.map((group) => ({
      paymentType: group.category,
      count: group._count.category,
      totalAmount: Number(group._sum.amountMinor ?? 0) / 100,
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Error fetching payment type stats:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 📊 8. MONTHLY REVENUE TREND (Success only)
 */
export const getMonthlyRevenueTrend = async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const start = startOfYear(new Date(year, 0));
    const end = endOfYear(new Date(year, 11));

    const raw = await prisma.$queryRaw<{ month: number; total: number }[]>`
      SELECT EXTRACT(MONTH FROM "paidAt") AS month,
             SUM("amountMinor") / 100.0 AS total
      FROM "PaymentCharge"
      WHERE "status" = 'PAID' AND "paidAt" BETWEEN ${start} AND ${end}
      GROUP BY month ORDER BY month;
    `;

    const months = [
      "January","February","March","April","May","June",
      "July","August","September","October","November","December"
    ];
    const values = Array(12).fill(0);
    raw.forEach((r) => (values[r.month - 1] = Number(r.total ?? 0)));

    return res.status(200).json({
      success: true,
      data: { labels: months, values },
    });
  } catch (error) {
    console.error("Error fetching revenue trend:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 🪪 9. CERTIFICATE REQUEST ANALYTICS
 */
export const getCertificateRequestStats = async (req: Request, res: Response) => {
  try {
    const counts = await prisma.requestCase.groupBy({
      by: ["status"],
      where: { certificateRequestId: { not: null } },
      _count: { status: true },
    });

    const formatted = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));

    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Error fetching certificate stats:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * 🧍‍♂️ 10. RECENT USER ACTIVITY (logins, signups)
 */
export const getRecentUserActivity = async (req: Request, res: Response) => {
  try {
    const [recentLogins, recentSignups] = await Promise.all([
      prisma.user.findMany({
        orderBy: { lastLogin: "desc" },
        take: 10,
        select: { phone: true, fullName: true, email: true, lastLogin: true },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { phone: true, fullName: true, email: true, createdAt: true },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: { recentLogins, recentSignups },
    });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};


// 11. QUERY STATISTICS
export const getQueryStats = async (req: Request, res: Response): Promise<Response> => {
  try {
     const [totalQueries, resolved, pending] = await Promise.all([
      prisma.userQuery.count(),
      prisma.userQuery.count({ where: { isResolved: true } }),
      prisma.userQuery.count({ where: { isResolved: false } }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Query statistics fetched successfully",
      data: {
        totalQueries,
        resolved,
        pending,
      },
    });
  } catch (error) {
    console.error("Error fetching query stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching query statistics",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
