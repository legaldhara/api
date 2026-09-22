import express from "express";

import { asyncHandler } from "../utils/lib";
import { buyPlan, buyPlanByRazorpay, getPlans } from "../controller/plan.contoller";

const router = express.Router();

router.get("/", asyncHandler(getPlans));
router.post("/buy", asyncHandler(buyPlan));
router.post("/create-order", asyncHandler(buyPlanByRazorpay));

export default router;
