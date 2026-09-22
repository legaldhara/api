import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { getAllPayments, getPaymentById, getUserPayments, phonepePaymentGatewayResponse, verifyRazorpayPayment } from "../controller/payment.controller";

const router = express.Router();

router.get('/response/:paymentReference', asyncHandler(phonepePaymentGatewayResponse));

router.post('/razorpay/verify-response', asyncHandler(verifyRazorpayPayment));

router.use(authenticate);

router.get("/user", asyncHandler(getUserPayments));

router.get("/:id", asyncHandler(getPaymentById));

router.use(authorize("ADMIN","COADMIN"));

router.get("/user/all", asyncHandler(getAllPayments));


export default router;
