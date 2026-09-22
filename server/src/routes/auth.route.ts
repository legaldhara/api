import express from "express";
import { asyncHandler } from "../utils/lib";
import {
  authSession,
  localhost,
  logout,
  refreshSession,
  loginAdminByPhone,
  userRegister,
//   getUserProfile,
//   updateUserProfile,
  registerCoadmin,
  loginUserByEmailAndPassword,
  loginUserByPhone,
  updateUserPassword,
} from "../controller/auth.controller";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";

const router = express.Router();

router.post('/validate', asyncHandler(localhost)); 

router.post('/admin/login', asyncHandler(loginAdminByPhone));

router.post('/user/login-by-phone', asyncHandler(loginUserByPhone));
router.post('/user/login-by-email', asyncHandler(loginUserByEmailAndPassword));

router.post('/refresh', asyncHandler(refreshSession));

router.post("/user/register", asyncHandler(userRegister));

router.post("/user/update-password", asyncHandler(updateUserPassword));

router.use(authenticate);

router.get('/session', asyncHandler(authSession));
router.post('/logout', asyncHandler(logout));


// --- Profile Related
// router.get("/user/get-profile", asyncHandler(getUserProfile));
// router.put("/user/update-profile", asyncHandler(updateUserProfile));

// --- Admin Related

// --- CoAdmin Related
router.use(authorize("ADMIN"));
router.post("/coadmin/register", asyncHandler(registerCoadmin));


export default router;
