import express from "express";

import { asyncHandler } from "../utils/lib";
import { createPlanCharge, getPlans } from "../controller/plan.contoller";
import { authenticate } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", asyncHandler(getPlans));
router.post("/:planId/charge", authenticate, asyncHandler(createPlanCharge));

export default router;
