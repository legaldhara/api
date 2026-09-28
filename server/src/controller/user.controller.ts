import { Request, Response } from "express";
import { prisma } from "../config/db";
import { updateUserProfileSchema } from "../zodSchema/user.schema";
import { AuthRequest } from "../types/custom";

export const getAllUsers = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const page = parseInt(req.query.page as string) || 1;

    if (limit <= 0 || page <= 0) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be greater than 0",
      });
    }

    const skip = (page - 1) * limit;

    // 🔍 Search + Filters
    const search = (req.query.search as string) || "";
    const isActive = req.query.isActive ? req.query.isActive === "true" : undefined;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const lastLoginStart = req.query.lastLoginStart
      ? new Date(req.query.lastLoginStart as string)
      : undefined;
    const lastLoginEnd = req.query.lastLoginEnd
      ? new Date(req.query.lastLoginEnd as string)
      : undefined;

    // 📌 Prisma where query
    const whereClause: any = {
      role: { not: "ADMIN" },

      ...(search && {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      }),

      ...(isActive !== undefined && { isActive }),

      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
        : {}),

      ...(lastLoginStart || lastLoginEnd
        ? {
          lastLogin: {
            ...(lastLoginStart && { gte: lastLoginStart }),
            ...(lastLoginEnd && { lte: lastLoginEnd }),
          },
        }
        : {}),
    };

    const [users, totalUsers] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        where: whereClause,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          lastLogin: true,
          _count: {
            select: {
              applications: true,
              query: true,
              paymentCharges: true,
              userPlans: true,
              certificateRequests: true,
            },
          },
        },
      }),

      prisma.user.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalUsers / limit);

    return res.status(200).json({
      success: true,
      data: users,
      pagination: {
        totalUsers,
        totalPages,
        page,
        limit,
      },
    });
  } catch (err: any) {
    console.error("Error in getAllUsers:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};


export const getUserById = async (
  req: Request,
  res: Response
): Promise<Response | void> => {

  try {
    const authUser = (req as AuthRequest).auth; // comes from your auth middleware
    const paramUserId = req.params.id;

    if (!authUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login first.",
      });
    }

    let userId: string | undefined;

    // 🧩 If role = USER → get own profile (from token)
    if (authUser.role === "USER") {
      userId = authUser.id;
    }

    // 🧩 If role = ADMIN or COADMIN → require ID param
    else if (["ADMIN", "COADMIN"].includes(authUser.role)) {
      if (!paramUserId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required.",
        });
      }
      userId = paramUserId;
    }

    // 🧩 Otherwise reject
    else {
      return res.status(403).json({
        success: false,
        message: "Access denied, Unauthorized.",
      });
    }

    // Return a rich user dashboard payload suitable for both admin and user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        email: true,
        phone: true,
        dob: true,
        gender: true,
        city: true,
        role: true,
        isActive: true,
        emailVerified: true,
        lastLogin: true,
        loginAttempts: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            applications: true,
            updates: true,
            query: true,
          },
        },
        // Applications with latest related payments and recent updates
        applications: {
          orderBy: { createdAt: 'desc' },
          select: {
            ticketNo: true,
            serviceName: true,
            serviceFor: true,
            applicationStatus: true,
            objectionReason: true,
            createdAt: true,
            // only include successful payments for each application (recent ones)
            paymentCharges: {
              where: { status: 'PAID' },
              orderBy: { paidAt: 'desc' },
              select: {
                amountMinor: true,
                category: true,
                status: true,
                paidAttemptId: true,
                paidAt: true,
                purpose: true,
              },
              take: 5,
            },
            updates: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                message: true,
                prevStatus: true,
                newStatus: true,
                paymentId: true,
                updateCharges: true,
                type: true,
                createdAt: true,
                updater: { select: { fullName: true } },
              },
            },
          },
        },

        // Recent queries (support requests) by the user
        query: {
          orderBy: { createdAt: 'desc' },
          select: {
            subject: true,
            message: true,
            isResolved: true,
            response: true,
            createdAt: true,
            resolvedAt: true,
          },
          take: 20,
        },
        // Recent raw updates the user is related to (if any)
        updates: {
          orderBy: { createdAt: 'desc' },
          select: {
            applicationId: true,
            message: true,
            prevStatus: true,
            newStatus: true,
            paymentId: true,
            updateCharges: true,
            type: true,
            createdAt: true,
          },
          take: 10,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (err: any) {
    console.error("Error fetching user by ID:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};


export const updateUser = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const user = (req as AuthRequest).auth;
  if (!user?.id) {
    return res.status(401).json({ success: false, message: "Unauthorized: User not authenticated" });
  }

  const parsed = updateUserProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Validation failed" });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!existingUser) return res.status(404).json({ success: false, message: "User not found" });

    const { fullName, dob, gender, city } = parsed.data;
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(dob !== undefined && { dob: new Date(`${dob}T00:00:00.000Z`) }),
        ...(gender !== undefined && { gender }),
        ...(city !== undefined && { city }),
      },
      select: {
        fullName: true,
        dob: true,
        gender: true,
        city: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "User profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Update user error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


// export const deleteUser = async (
//   req: Request,
//   res: Response
// ): Promise<Response | void> => {
//   const userId = req.params.id;

//   if (!userId) {
//     return res.status(400).json({
//       success: false,
//       message: "User ID is required in the URL",
//     });
//   }

//   try {
//     const existingUser = await prisma.user.findUnique({
//       where: { id: userId },
//     });

//     if (!existingUser) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     if (!existingUser.isActive) {
//       return res.status(400).json({
//         success: false,
//         message: "User is already deactivated",
//       });
//     }

//     const updatedUser = await prisma.user.update({
//       where: { id: userId },
//       data: {
//         isActive: false,
//         updatedAt: new Date(),
//       },
//       select: {
//         id: true,
//         fullName: true,
//         email: true,
//         phone: true,
//         isActive: true,
//         role: true,
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: "User soft-deleted (deactivated) successfully",
//       user: updatedUser,
//     });
//   } catch (err: any) {
//     console.error("Soft delete error:", err.message);
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: err.message,
//     });
//   }
// };


