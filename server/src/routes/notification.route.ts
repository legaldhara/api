import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { listNotifications, markAllRead, markAsRead, saveFCMToken, unreadCount } from "../controller/notification.controller";
import { authorize } from "../middleware/authorize";

const router = express.Router();

router.use(authenticate);

router.post('/save-token', asyncHandler(saveFCMToken));

router.use(authorize('COADMIN', 'ADMIN'));

router.get('/', asyncHandler(listNotifications));
router.get('/unread-count', asyncHandler(unreadCount));
router.post('/mark-read/:id', asyncHandler(markAsRead));
router.post('/mark-all-read', asyncHandler(markAllRead));

export default router;
