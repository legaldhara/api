import { Request, Response } from 'express';
import { fileUploadUtil, deleteFile } from '../config/cloudinary';

import { logger } from '../utils/logger';
import { MulterRequest } from '../types/custom';

export const uploadImages = async (req: Request, res: Response): Promise<Response | void> => {
    try {
        const multerReq = req as MulterRequest;

        if (!multerReq.files || multerReq.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No files uploaded",
            });
        }

        if (multerReq.files.length > 4) {
            return res.status(400).json({
                success: false,
                message: "You can upload a maximum of 4 files.",
            });
        }

        // Convert file buffers to Base64 format
        const base64Files = multerReq.files.map((file) =>
            `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
        );

        multerReq.folder = req.body.folder || 'default';

        // Upload images to Cloudinary
        const results = await fileUploadUtil(multerReq.files, multerReq.folder);
        if (!results) {
            return res.status(401).json({
                success: false,
                message: "Image upload error",
            })
        }

        return res.status(200).json({
            success: true,
            message: "Uploaded Successfully",
            urls: results.map((result) => result.secure_url),
            publicIds: results.map((result) => result.public_id),
        });
    } catch (error) {
        logger.error("Image upload error:", error);

    }
};

export const deleteImageHandler = async (req: Request, res: Response) => {
    try {
        const { publicId } = req.params;
        if (!publicId) {
            return res.status(400).json({ success: false, message: 'publicId required' });
        }
        await deleteFile(publicId);
        return res.status(200).json({ success: true, message: 'Image deleted' });
    } catch (error) {
        logger.error('Image delete error:', error);
        return res.status(500).json({ success: false, message: 'Delete failed' });
    }
};