import { getMessaging } from 'firebase-admin/messaging';
import { prisma } from '../config/db';
import { AudienceType, Role } from '@prisma/client';

class NotificationService {
    constructor() { }

    async sendNotification(payload: any, token: string) {
        try {
            const messaging = getMessaging();
            const message = {
                token,
                notification: {
                    title: payload.title,
                    body: payload.body,
                },
                data: payload.data || {},
            };

            const response = await messaging.send(message);
            console.log(response);
            return response;

        } catch (err: any) {
            console.error('Error sending notification:', err);

            if (err.code === 'messaging/registration-token-not-registered') {
                await this.handleInvalidToken(token);
            }
        }
    }

    async sendNotificationToMultiple(payload: any, tokens: string[]) {
        try {
            const messaging = getMessaging();
            const message = {
                notification: {
                    title: payload.title,
                    body: payload.body,
                },
                data: payload.data || {},
                tokens,
            };

            const response = await messaging.sendEachForMulticast(message);

            // Clean up invalid tokens
            for (let i = 0; i < response.responses.length; i++) {
                const resp = response.responses[i];
                if (!resp.success && resp?.error?.code === 'messaging/registration-token-not-registered') {
                    await this.handleInvalidToken(tokens[i]);
                }
            }

            console.log(response);
            return response;

        } catch (err) {
            console.error('Error sending multiple notifications:', err);
        }
    }

    // async getAdminAndCoAdminFcmTokens(): Promise<string[]> {
    //     try {
    //         const tokens = await prisma.token.findMany({
    //             where: {
    //                 role: {
    //                     in: ['ADMIN', 'COADMIN'], // Adjust enums/case as per schema
    //                 },
    //                 type: 'FCM',
    //             },
    //             select: {
    //                 token: true,
    //                 accountId: true
    //             },
    //         });

    //         return tokens.filter(t => typeof t.token === 'string' && t.token.length > 0);

    //     } catch (err) {
    //         console.error('Error fetching admin and co-admin FCM tokens:', err);
    //         return [];
    //     }
    // }

    async handleInvalidToken(token: string) {
        try {
            const deletedCount = await prisma.token.deleteMany({
                where: {
                    token: token,
                    type: 'FCM',
                },
            });

            if (deletedCount.count > 0) {
                console.warn(`Removed invalid FCM token: ${token}`);
            } else {
                console.warn(`No FCM token found to remove for: ${token}`);
            }
        } catch (err) {
            console.error(`Error removing FCM token ${token}:`, err);
        }
    }


    async createAdminNotification({
        title,
        body,
        clickAction = "",
        notificationType = "general",
        role = "ADMIN",
        audienceType = "SPECIFIC",
    }: {
        title: string;
        body: string;
        clickAction?: string;
        notificationType?: string;
        role?: Role;
        audienceType?: AudienceType;
    }) {
        const notification = await prisma.notification.create({
            data: {
                title,
                body,
                role,
                audienceType,
                notificationType,
                clickAction,
            }
        });

        // Optionally link to application via Notification.meta? (if you need applicationId, include in body or add a column)
        // emit socket event
        // try {
        //     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //     // @ts-ignore
        //     io?.to("ADMINS")?.emit("new-notification", {
        //         id: notification.id,
        //         title: notification.title,
        //         body: notification.body,
        //         createdAt: notification.createdAt,
        //         trackingId,
        //     });
        // } catch (e) {
        //     console.error("Socket emit failed:", e);
        // }

        return notification;
    }
}

export default new NotificationService();
