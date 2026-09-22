import express from "express";
import { authenticate } from "../middleware/authMiddleware";
import { upload } from "../config/cloudinary";
import { asyncHandler } from "../utils/lib";
import { deleteImageHandler, uploadImages } from "../controller/media.controller";


const router = express.Router();

router.use(authenticate);

router.post('/upload', upload.array('files', 5), asyncHandler(uploadImages))
router.delete('/delete/:publicId', asyncHandler(deleteImageHandler))

export default router;