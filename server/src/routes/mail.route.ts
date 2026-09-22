// src/routes/mail.routes.ts
import { Router } from "express";
import { sendMailController, receiveMailController } from "../controller/mail.controller";
import { asyncHandler } from "../utils/lib";

const router = Router();

router.post("/send", asyncHandler(sendMailController));
router.get("/receive", asyncHandler(receiveMailController));
 
export default router;
