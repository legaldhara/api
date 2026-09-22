import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { createApplication, initiatePhonepePayment, deleteApplication, getAllApplications, getApplicationById, getUserApplications, createUserApplicationPayment, getApplicationUpdates, createApplicationUpdate, initiateRazorpayPayment,  } from "../controller/application.controller";

const router = express.Router();


router.post("/direct/apply", asyncHandler(createUserApplicationPayment));

router.use(authenticate);
router.post("/create", asyncHandler(createApplication));

router.post('/pay', asyncHandler(initiatePhonepePayment)); 

router.post('/create-order', asyncHandler(initiateRazorpayPayment)); 

router.get("/my", asyncHandler(getUserApplications));

router.get("/:ticketNo", asyncHandler(getApplicationById));

// router.get("/updates/:ticketNo", asyncHandler(getApplicationUpdates));

router.post("/update/:ticketNo",  asyncHandler(createApplicationUpdate));

router.use(authorize("ADMIN","COADMIN"));

router.get("/apps/all", asyncHandler(getAllApplications));

// router.put("/update/:id", asyncHandler(updateApplication));

router.delete("/delete/:ticketNo", asyncHandler(deleteApplication));
// router.post("/admin/update/:ticketNo", asyncHandler(createAdminApplicationUpdate));

export default router;
