import express from "express";
import { getSession } from "../controller/session.controller";
import { authenticate, authenticateFirebaseIdentity } from "../middleware/authMiddleware";
import { asyncHandler } from "../utils/lib";
import { authorize } from "../middleware/authorize";
import { clearAdminMfa, confirmMfa, enrollMfa, skipAdminMfaForDevelopment, verifyAdminMfa } from "../controller/adminMfa.controller";
import { completeSignup, requestSignupPhoneOtp, verifySignupPhoneOtp } from "../controller/customerSignup.controller";
import { requestPhoneLoginOtp, verifyPhoneLoginOtp } from "../controller/customerLogin.controller";

const router = express.Router();
router.post("/otp/login/request", asyncHandler(requestPhoneLoginOtp));
router.post("/otp/login/verify", asyncHandler(verifyPhoneLoginOtp));
router.post("/signup/phone/request", authenticateFirebaseIdentity, asyncHandler(requestSignupPhoneOtp));
router.post("/signup/phone/verify", authenticateFirebaseIdentity, asyncHandler(verifySignupPhoneOtp));
router.post("/signup/complete", authenticateFirebaseIdentity, asyncHandler(completeSignup));
router.get("/session", authenticate, asyncHandler(getSession));
router.post("/mfa/enroll", authenticate, authorize("ADMIN", "COADMIN"), asyncHandler(enrollMfa));
router.post("/mfa/confirm", authenticate, authorize("ADMIN", "COADMIN"), asyncHandler(confirmMfa));
router.post("/mfa/verify", authenticate, authorize("ADMIN", "COADMIN"), asyncHandler(verifyAdminMfa));
router.post("/mfa/skip-development", authenticate, authorize("ADMIN", "COADMIN"), asyncHandler(skipAdminMfaForDevelopment));
router.post("/mfa/logout", authenticate, asyncHandler(clearAdminMfa));

export default router;
