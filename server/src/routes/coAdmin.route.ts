import { Router } from "express";
import { inviteCoAdminController, listCoAdminsController, resendCoAdminInvitationController, setCoAdminStatusController } from "../controller/coAdmin.controller";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { requireAdminMfa } from "../middleware/requireAdminMfa";
import { asyncHandler } from "../utils/lib";

const router = Router();
router.use(authenticate);
router.use(authorize("ADMIN"));
router.use(requireAdminMfa);
router.get("/", asyncHandler(listCoAdminsController));
router.post("/invite", asyncHandler(inviteCoAdminController));
router.post("/:id/invitation", asyncHandler(resendCoAdminInvitationController));
router.patch("/:id/status", asyncHandler(setCoAdminStatusController));

export default router;