import express, { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { authenticate } from "../../middleware/authMiddleware";
import { authorize } from "../../middleware/authorize";
import { requireAdminMfa } from "../../middleware/requireAdminMfa";
import { asyncHandler } from "../../utils/lib";
import * as controller from "./case.controller";
import {
  cancelRequirementSchema,
  completeSchema,
  deliverableSchema,
  documentRequestSchema,
  documentSubmissionSchema,
  emptyCommandSchema,
  messageSchema,
  paymentRequestSchema,
  rejectSchema,
} from "./schemas";

const validate = (schema: ZodType) => (request: Request, response: Response, next: NextFunction) => {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ success: false, error: "Invalid request", issues: parsed.error.issues });
    return;
  }
  request.body = parsed.data;
  next();
};

const router = express.Router();
router.use(authenticate);

router.get("/:caseId", asyncHandler(controller.getCase));
router.post("/:caseId/messages", validate(messageSchema), asyncHandler(controller.postMessage));
router.post(
  "/:caseId/requirements/:requirementId/documents",
  validate(documentSubmissionSchema),
  asyncHandler(controller.submitDocuments),
);

const admin = [authorize("ADMIN", "COADMIN"), requireAdminMfa];
router.post("/:caseId/review", ...admin, validate(emptyCommandSchema), asyncHandler(controller.startReview));
router.post(
  "/:caseId/requirements/documents",
  ...admin,
  validate(documentRequestSchema),
  asyncHandler(controller.requestDocuments),
);
router.post(
  "/:caseId/requirements/payment",
  ...admin,
  validate(paymentRequestSchema),
  asyncHandler(controller.requestPayment),
);
router.post(
  "/:caseId/requirements/:requirementId/cancel",
  ...admin,
  validate(cancelRequirementSchema),
  asyncHandler(controller.cancelRequirement),
);
router.post("/:caseId/approve", ...admin, validate(emptyCommandSchema), asyncHandler(controller.approveCase));
router.post("/:caseId/reject", ...admin, validate(rejectSchema), asyncHandler(controller.rejectCase));
router.post("/:caseId/deliverables", ...admin, validate(deliverableSchema), asyncHandler(controller.attachDeliverable));
router.post("/:caseId/complete", ...admin, validate(completeSchema), asyncHandler(controller.completeCase));
router.post(
  "/:caseId/close",
  authorize("ADMIN"),
  requireAdminMfa,
  validate(emptyCommandSchema),
  asyncHandler(controller.closeCase),
);

export default router;
