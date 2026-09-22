import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { getApplicationCountByService, getApplicationCountByStatus, getCertificateRequestStats, getRecentUserActivity, getApplicationTrendByMonth, getMonthlyUserRegistration, getPaymentSummary, getRevenueAndCountByPaymentType, getUserAnalyticsSummary, getQueryStats } from "../controller/dashboard.controller";

const dashboardRouter = express.Router();

dashboardRouter.use(authenticate);

dashboardRouter.use(authorize("ADMIN", "COADMIN"));

dashboardRouter.get("/users/summary", asyncHandler(getUserAnalyticsSummary));
dashboardRouter.get("/users/monthly", asyncHandler(getMonthlyUserRegistration));
dashboardRouter.get("/users/activity", asyncHandler(getRecentUserActivity));
dashboardRouter.get("/applications/status", asyncHandler(getApplicationCountByStatus));
dashboardRouter.get("/applications/service", asyncHandler(getApplicationCountByService));
dashboardRouter.get("/applications/trend", asyncHandler(getApplicationTrendByMonth));
dashboardRouter.get("/payments/summary", asyncHandler(getPaymentSummary));
dashboardRouter.get("/payments/type", asyncHandler(getRevenueAndCountByPaymentType));
dashboardRouter.get("/payments/revenue", asyncHandler(getRevenueAndCountByPaymentType));
dashboardRouter.get("/certificates/requests", asyncHandler(getCertificateRequestStats));
dashboardRouter.get("/queries/stats", asyncHandler(getQueryStats));



export default dashboardRouter;
