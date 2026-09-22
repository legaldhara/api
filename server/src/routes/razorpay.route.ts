import express from "express";
import bodyParser from "body-parser";
import { handleRazorpayWebhook } from "../controller/payment.controller";
import { asyncHandler } from "../utils/lib";

const router = express.Router();

const rawBodySaver = (req: any, res: any, buf: Buffer, encoding: string) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString('utf8');
  } 
};

// Razorpay webhook route - MUST be first, before express.json()
router.post('/razorpay/callback',
  bodyParser.raw({
    type: 'application/json',
    verify: rawBodySaver
  }),
  asyncHandler(handleRazorpayWebhook)
);

export default router;
