import { deleteFile, fileUploadUtil } from "../config/cloudinary";

export interface StoredObject {
  publicId: string;
  secureUrl: string;
  resourceType: string;
}

export interface AssetStorage {
  upload(file: Express.Multer.File, folder: string): Promise<StoredObject>;
  delete(publicId: string, resourceType: string): Promise<"deleted" | "not_found">;
}

export const cloudStorage: AssetStorage = {
  async upload(file, folder) {
    const [uploaded] = await fileUploadUtil([file], folder);
    if (!uploaded) throw new Error("Cloud storage did not return an uploaded object");
    return {
      publicId: uploaded.public_id,
      secureUrl: uploaded.secure_url,
      resourceType: uploaded.resource_type,
    };
  },
  async delete(publicId, resourceType) {
    const result = await deleteFile(publicId, resourceType === "image" ? "image" : "raw");
    return result?.result === "not found" ? "not_found" : "deleted";
  },
};