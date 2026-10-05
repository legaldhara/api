import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { requireAdminMfa } from "../middleware/requireAdminMfa";
import { createApplication, deleteApplication, getAllApplications, getApplicationById, getUserApplications, createApplicationUpdate } from "../controller/application.controller";
import { legacyApplicationMessage } from "../modules/cases/case.controller";
import { messageSchema } from "../modules/cases/schemas";

const router = express.Router();


router.use(authenticate);
router.post("/create", asyncHandler(createApplication));

router.get("/my", asyncHandler(getUserApplications));

router.get("/:ticketNo", asyncHandler(getApplicationById));

// router.get("/updates/:ticketNo", asyncHandler(getApplicationUpdates));

router.post("/update/:ticketNo", (request, response, next) => {
  const parsed = messageSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ success: false, error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  request.body = parsed.data;
  next();
}, asyncHandler(legacyApplicationMessage));

router.use(authorize("ADMIN","COADMIN"));
router.use(requireAdminMfa);

router.get("/apps/all", asyncHandler(getAllApplications));

// router.put("/update/:id", asyncHandler(updateApplication));

router.delete("/delete/:ticketNo", asyncHandler(deleteApplication));
// router.post("/admin/update/:ticketNo", asyncHandler(createAdminApplicationUpdate));

export default router;
