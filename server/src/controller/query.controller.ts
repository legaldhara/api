import { Request, Response } from "express";
import { prisma } from "../config/db";
import { formatToIndianNumber } from "../utils/lib";
import { userQuerySchema, resolveQuerySchema } from "../zodSchema/query.schema";
import { generateTicketNumber } from "../utils/ticketGenerator";
import { getQueryReceivedEmail, getQueryResolvedEmail } from "../utils/email";
import { logger } from "../utils/logger";
import MailService from "../services/Mail";
import Notification from "../services/Notification";
import { getIo } from "../socket";

export const createUserQuery = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const parsed = userQuerySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten(),
    });
  }

  const { subject, message, fullName, email, phone } = parsed.data;

  try {
    // check if user exists by email or phone
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase() }, { phone: formatToIndianNumber(phone) }],
      },
    });

    // if user not found, create new user
    if (!user) {
      user = await prisma.user.create({
        data: {
          fullName,
          email: email.toLowerCase(),
          phone: formatToIndianNumber(phone),
          isActive: false,
          termsAccepted: false,
        },
      });
    }

    // always create a new query (even if user exists)
    const newQuery = await prisma.userQuery.create({
      data: {
        userId: user.id,
        queryNo: generateTicketNumber('QRY'),
        subject,
        message,
      },
    });


    const emailContent = getQueryReceivedEmail(
      fullName, newQuery.queryNo
    );

    await MailService.send(
      user.email,
      emailContent.subject,
      emailContent.text,
      "info",
      emailContent.html
    ).catch((err: any) => logger.error("Email send failed", { err }));

    await Notification.createAdminNotification({
      title: `New Query Received: ${newQuery.queryNo}.`,
      body: `A new query submitted by ${fullName}.`,
      notificationType: "query",
      role: "ADMIN",
      audienceType: "SPECIFIC",
      clickAction: `/queries`, // where admin should click
    });

    // 🔴 Emit live socket event (your existing code)
    getIo().to("ADMINS").emit("new-notification", {
      trackingId: newQuery.queryNo,
      message: `A new query submitted by ${fullName}`,
      status: newQuery.isResolved ? "resolved" : "pending",
      createdAt: new Date(),
      clickAction: `/queries`,
    });

    const { id, userId, ...queryData } = newQuery;

    return res.status(201).json({
      success: true,
      message: "Query submitted successfully",
      query: queryData,
    });
  } catch (err: any) {
    console.error("Create User Query Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};



export const getAllUserQueries = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // 🔍 Search + Filters
    const search = (req.query.search as string) || "";
    const role = req.query.role as string;
    const city = req.query.city as string;
    const emailVerified = req.query.emailVerified
      ? req.query.emailVerified === "true"
      : undefined;

    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;

    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;

    // 📌 Build where clause
    const whereClause: any = {
      ...(search && {
        OR: [
          { message: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },

          // 🔍 Search inside user's fields
          {
            user: {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        ],
      }),

      ...(role && { user: { role } }),

      ...(city && { user: { city: { contains: city, mode: "insensitive" } } }),

      ...(emailVerified !== undefined && {
        user: { emailVerified },
      }),

      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: startDate }),
              ...(endDate && { lte: endDate }),
            },
          }
        : {}),
    };

    const [queries, totalCount] = await Promise.all([
      prisma.userQuery.findMany({
        skip,
        take: limit,
        where: whereClause,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
              phone: true,
              lastLogin: true,
              city: true,
              role: true,
              emailVerified: true,
            },
          },
        },
      }),

      prisma.userQuery.count({ where: whereClause }),
    ]);

    // 🧹 Remove id, userId from results
    const result = queries.map(({ id, userId, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      queries: result,
    });
  } catch (err: any) {
    console.error("Get All User Queries Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};



export const getQueryById = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const { queryNo } = req.params;

  if (!queryNo) {
    return res.status(400).json({
      success: false,
      message: "Query No is required",
    });
  }

  try {
    const query = await prisma.userQuery.findUnique({
      where: { queryNo },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!query) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    return res.status(200).json({
      success: true,
      query,
    });
  } catch (err: any) {
    console.error("Get Query By ID Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};


export const resolveQueryById = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const { queryNo } = req.params;

  if (!queryNo) {
    return res.status(400).json({
      success: false,
      message: "Query No is required in the URL",
    });
  }

  const parsed = resolveQuerySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
    });
  }

  const { response: adminResponse } = parsed.data;

  try {
    const existingQuery = await prisma.userQuery.findUnique({
      where: { queryNo },
    });

    if (!existingQuery) {
      return res.status(404).json({
        success: false,
        message: "Query not found",
      });
    }

    if (existingQuery.isResolved) {
      return res.status(400).json({
        success: false,
        message: "Query is already resolved",
      });
    }

    const updatedQuery = await prisma.userQuery.update({
      where: { queryNo },
      data: {
        response: adminResponse,
        isResolved: true,
        resolvedAt: new Date(),
      },
      include: {
        user: {
          select: {
            email: true,
            fullName: true,
          }
        }
      }
    });


    const { user, id, userId, ...rest } = updatedQuery;

    if (process.env.NODE_ENV === "production" && user?.email) {
      const emailContent = getQueryResolvedEmail(
        user.fullName,
        adminResponse,
      );

      await MailService.send(
        user.email,
        emailContent.subject,
        emailContent.text,
        "info",
        emailContent.html
      ).catch((err: any) => logger.error("Email send failed", { err }));
    }

    return res.status(200).json({
      success: true,
      message: "Query resolved successfully",
      response: rest,
    });
  } catch (err: any) {
    console.error("Resolve Query Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};
