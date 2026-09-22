import express from "express";
import bodyParser from "body-parser";
import { phonepeUnifiedCallback } from "../controller/payment.controller";
import { asyncHandler } from "../utils/lib";

const router = express.Router();

const rawBodySaver = (req: any, res: any, buf: Buffer, encoding: string) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString('utf8');
  }
};

// PhonePe webhook route - MUST be first, before express.json()
router.post('/phonepe/callback',
  bodyParser.raw({
    type: 'application/json',
    verify: rawBodySaver
  }),
  asyncHandler(phonepeUnifiedCallback)
);

export default router;
