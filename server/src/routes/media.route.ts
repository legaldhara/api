import express from "express";
import { acceptUploads } from "../config/uploadPolicy";
import { deleteImageHandler, uploadImages } from "../controller/media.controller";
import { authenticate } from "../middleware/authMiddleware";
import { asyncHandler } from "../utils/lib";

const router = express.Router();

router.use(authenticate);
router.post("/upload", acceptUploads, asyncHandler(uploadImages));
router.delete("/:assetId", asyncHandler(deleteImageHandler));

export default router;