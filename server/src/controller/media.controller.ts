import { Request, Response } from "express";
import { AuthRequest, MulterRequest } from "../types/custom";
import { AssetAccessError, createManagedUploads, deleteManagedAsset } from "../services/uploadedAsset";
import { logger } from "../utils/logger";

export const uploadImages = async (request: Request, response: Response): Promise<Response> => {
  const files = (request as MulterRequest).files || [];
  if (files.length === 0) {
    return response.status(400).json({ success: false, message: "No files uploaded" });
  }

  try {
    const assets = await createManagedUploads({ files, actor: (request as AuthRequest).auth });
    return response.status(201).json({
      success: true,
      message: "Uploaded successfully",
      assets: assets.map((asset) => ({
        assetId: asset.id,
        url: asset.secureUrl,
        publicId: asset.publicId,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      })),
      urls: assets.map((asset) => asset.secureUrl),
      publicIds: assets.map((asset) => asset.publicId),
    });
  } catch (error) {
    logger.error("File upload error", error);
    return response.status(502).json({ success: false, message: "Upload failed" });
  }
};

export const deleteImageHandler = async (request: Request, response: Response): Promise<Response> => {
  try {
    const asset = await deleteManagedAsset({
      assetId: request.params.assetId,
      actor: (request as AuthRequest).auth,
    });
    return response.status(200).json({ success: true, assetId: asset.id, status: asset.status });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      return response.status(error.statusCode).json({ success: false, message: error.message });
    }
    logger.error("File delete error", error);
    return response.status(502).json({ success: false, message: "Delete failed" });
  }
};