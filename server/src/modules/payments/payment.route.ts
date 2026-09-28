import express, { NextFunction, Request, RequestHandler, Response } from "express";
import { authenticate } from "../../middleware/authMiddleware";
import { requireAdminMfa } from "../../middleware/requireAdminMfa";
import { AuthRequest } from "../../types/custom";
import { asyncHandler } from "../../utils/lib";
import { paymentController, paymentErrorHandler } from "./payment.controller";

type PaymentController = typeof paymentController;

interface PaymentRouterDependencies {
  controller: PaymentController;
  authenticate: RequestHandler;
  requireMfa: RequestHandler;
}

const requireRole = (...roles: Array<"ADMIN" | "COADMIN" | "USER">): RequestHandler => (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const auth = (request as AuthRequest).auth;
  if (!auth || !roles.includes(auth.role)) {
    response.status(403).json({ success: false, error: "Forbidden" });
    return;
  }
  next();
};

export const createPaymentRouter = (overrides: Partial<PaymentRouterDependencies> = {}) => {
  const deps: PaymentRouterDependencies = {
    controller: paymentController,
    authenticate,
    requireMfa: requireAdminMfa,
    ...overrides,
  };
  const router = express.Router();
  router.use(deps.authenticate);
  router.post("/charges/:chargeId/attempts", asyncHandler(deps.controller.createAttempt));
  router.post("/attempts/confirm", asyncHandler(deps.controller.confirmAttempt));
  router.get("/mine", asyncHandler(deps.controller.listMine));
  router.get("/charges/:chargeId/status", asyncHandler(deps.controller.getChargeStatus));
  router.get("/charges/:chargeId", asyncHandler(deps.controller.getCharge));
  router.get("/admin", requireRole("ADMIN", "COADMIN"), deps.requireMfa, asyncHandler(deps.controller.listAdmin));
  router.get("/admin/:attemptId", requireRole("ADMIN", "COADMIN"), deps.requireMfa, asyncHandler(deps.controller.getAdminAttempt));
  router.post("/admin/:attemptId/reconcile", requireRole("ADMIN"), deps.requireMfa, asyncHandler(deps.controller.reconcileAttempt));
  router.post("/admin/:attemptId/refund", requireRole("ADMIN"), deps.requireMfa, asyncHandler(deps.controller.refundAttempt));
  router.use(paymentErrorHandler);
  return router;
};

export default createPaymentRouter();
