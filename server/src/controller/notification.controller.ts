import { Request, Response } from "express";
import { AuthRequest } from "../types/custom";
import { addDays } from 'date-fns';
import { prisma } from "../config/db";
import { getTokenFromHeader } from "../utils/lib";

export const saveFCMToken = async (req: Request, res: Response): Promise<Response | void> => {
    const { id: userId, role } = (req as AuthRequest)?.auth || {};
    const token = getTokenFromHeader(req);

    if (!token) {
        return res.status(400).json({ success: false, message: 'FCM token is required' });
    }

    if (!userId) {
        return res.status(400).json({ success: false, message: 'Account ID is missing or invalid' });
    }

    try {
        const expiredAt = addDays(new Date(), 30); // Example: expire in 30 days

        // Check if FCM token already exists for this user
        const existingToken = await prisma.token.findFirst({
            where: { userId, type: 'FCM' },
        });

        if (
            !existingToken ||
            existingToken.token !== token || // token changed
            new Date(existingToken.expiredAt) < new Date() // expired
        ) {
            const expiredAt = addDays(new Date(), 30);

            if (existingToken) {
                // Update if token changed or expired
                await prisma.token.update({
                    where: { id: existingToken.id },
                    data: { token, role, expiredAt },
                });
            } else {
                // Create new token
                await prisma.token.create({
                    data: { userId, token, role, type: 'FCM', expiredAt },
                });
            }
        }

        return res.status(201).json({
            success: true,
            message: 'Token saved successfully',
        });

    } catch (err: any) {
        console.error('Error saving FCM token:', err);

        if (err.code === 'P2002') {
            // Prisma unique constraint error
            return res.status(409).json({
                success: false,
                message: 'This token is already in use',
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal Server Error: Unable to save FCM token',
        });
    }
}



export const listNotifications = async (req: Request, res: Response) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const adminId = (req as AuthRequest).auth.id;

    const notifications = await prisma.notification.findMany({
        where: { role: "ADMIN" },
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
        include: {
            reads: {
                where: { userId: adminId },
                take: 1
            }
        }
    });


    // attach isRead flag
    const payload = notifications.map(n => ({
        id: n.id,
        title: n.title,
        body: n.body,
        role: n.role,
        createdAt: n.createdAt,
        clickAction: n.clickAction,
        notificationType: n.notificationType,
        audienceType: n.audienceType,
        isRead: n.reads?.length > 0 ? n.reads[0].isRead : false
    }));

    res.json(payload);
};

export const unreadCount = async (req: Request, res: Response) => {
    const adminId = (req as AuthRequest).auth.id;
    const count = await prisma.notification.count({
        where: {
            role: "ADMIN",
            reads: {
                none: {
                    userId: adminId,
                    isRead: true
                }
            }
        }
    });
    res.json({ count });
};

export const markAsRead = async (req: Request, res: Response) => {
    const adminId = (req as AuthRequest).auth.id;
    const { id } = req.params;

    // Check if record exists
    const existing = await prisma.notificationRead.findFirst({
        where: {
            notificationId: id,
            userId: adminId
        }
    });

    if (existing) {
        // Update existing
        await prisma.notificationRead.update({
            where: { id: existing.id },
            data: { isRead: true }
        });
    } else {
        // Create new
        await prisma.notificationRead.create({
            data: {
                notificationId: id,
                userId: adminId,
                isRead: true
            }
        });
    }

    res.json({ success: true });
};


export const markAllRead = async (req: Request, res: Response) => {
    const adminId = (req as AuthRequest).auth.id;

    // Get all unread notifications for this admin
    const unreadNotifications = await prisma.notification.findMany({
        where: {
            role: "ADMIN",
            reads: { none: { userId: adminId } }
        },
        select: { id: true }
    });

    // Process all notifications
    await Promise.all(
        unreadNotifications.map(async (n) => {
            // Check if read record exists
            const existing = await prisma.notificationRead.findFirst({
                where: {
                    notificationId: n.id,
                    userId: adminId
                }
            });

            if (existing) {
                // Update existing read record
                return prisma.notificationRead.update({
                    where: { id: existing.id },
                    data: { isRead: true }
                });
            }

            // Create a new read entry
            return prisma.notificationRead.create({
                data: {
                    notificationId: n.id,
                    userId: adminId,
                    isRead: true
                }
            });
        })
    );

    res.json({ success: true });
};
