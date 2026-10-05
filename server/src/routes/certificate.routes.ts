import express from "express";
import {
  createCertificateRequest,
  getUserCertificateRequests,
  getAllCertificateRequests,
  updateCertificateWithRoleBasedRules,
  getCertificateRequestByRequestNo
} from "../controller/certificate.controller";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { requireAdminMfa } from "../middleware/requireAdminMfa";
import { legacyCertificateMessage } from "../modules/cases/case.controller";
import { messageSchema } from "../modules/cases/schemas";

const router = express.Router();


router.use(authenticate);

router.post("/user/create", asyncHandler(createCertificateRequest));

router.get("/user/all", asyncHandler(getUserCertificateRequests));

router.get("/:requestNo", asyncHandler(getCertificateRequestByRequestNo));

router.put("/:requestNo/update", (request, response, next) => {
  const parsed = messageSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ success: false, error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  request.body = parsed.data;
  next();
}, asyncHandler(legacyCertificateMessage));

router.use(authorize("ADMIN", "COADMIN"));
router.use(requireAdminMfa);

// ADMIN routes
router.get("/admin/all", asyncHandler(getAllCertificateRequests));

export default router;
