import { Router } from "express";
import { sendMailController, receiveMailController } from "../controller/mail.controller";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { requireAdminMfa } from "../middleware/requireAdminMfa";
import { asyncHandler } from "../utils/lib";

const router = Router();

router.use(authenticate);
router.use(authorize("ADMIN", "COADMIN"));
router.use(requireAdminMfa);
router.post("/send", asyncHandler(sendMailController));
router.get("/receive", asyncHandler(receiveMailController));

export default router;