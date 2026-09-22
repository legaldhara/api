import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { getApplicationCountByService, getApplicationCountByStatus, getApplicationTrendByMonth, getMonthlyUserRegistration, getPaymentSummary, getRevenueAndCountByPaymentType, getUserAnalyticsSummary } from "../controller/dashboard.controller";
import { createDocument, getDocuments, updateDocument, deleteDocument } from "../controller/document.controller";

const router = express.Router();

router.use(authenticate);

router.post("/", asyncHandler(createDocument));
router.get("/", asyncHandler(getDocuments));
router.put("/:id", asyncHandler(updateDocument));
router.delete("/:id", asyncHandler(deleteDocument));

export default router;