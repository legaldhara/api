import express from "express";
import {
  createCertificateRequest,
  getUserCertificateRequests,
  getAllCertificateRequests,
  updateCertificateWithRoleBasedRules,
  initiatePhonepePayment,
  initiateRazorpayPayment,
  getCertificateRequestByRequestNo
} from "../controller/certificate.controller";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";

const router = express.Router();


// USER routes
router.post("/user/create", asyncHandler(createCertificateRequest));

router.use(authenticate);

router.get("/user/all", asyncHandler(getUserCertificateRequests));

router.get("/:requestNo", asyncHandler(getCertificateRequestByRequestNo));

router.put("/:requestNo/update", asyncHandler(updateCertificateWithRoleBasedRules));

router.post("/pay", asyncHandler(initiatePhonepePayment));
router.post("/create-order", asyncHandler(initiateRazorpayPayment));

router.use(authorize("ADMIN", "COADMIN"));

// ADMIN routes
router.get("/admin/all", asyncHandler(getAllCertificateRequests));

export default router;
