import express from "express";
import { createRazorpayWebhookHandler, RazorpayWebhookDependencies } from "./razorpayWebhook.controller";

export const createRazorpayWebhookRouter = (dependencies: Partial<RazorpayWebhookDependencies> = {}) => {
  const router = express.Router();
  router.post("/", express.raw({ type: "application/json", limit: "1mb" }), createRazorpayWebhookHandler(dependencies));
  return router;
};

export default createRazorpayWebhookRouter();
