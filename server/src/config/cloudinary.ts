import { v2 as cloudinary } from "cloudinary";
import 'dotenv/config'
import { logger } from "../utils/logger";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
})


// async function imageUploadUtil(files: string[], folder?: string): Promise<any[]> {
//     try {
//         const uploadPromises = files.map((file) =>
//             cloudinary.uploader.upload(file, { resource_type: "auto", folder })
//         );
//         return await Promise.all(uploadPromises);
//     } catch (error: any) {
//         logger.error('Upload Utility hook', error);
//         return Promise.reject({ success: false })
//     }
// }


// Delete image by public_id

async function fileUploadUtil(files: Express.Multer.File[], folder?: string) {
  try {
    const uploadPromises = files.map((file) => {
      const isPdf = file.mimetype === "application/pdf";
      const isImage = file.mimetype.startsWith("image/");

      const resourceType = isPdf ? "raw" : isImage ? "image" : "raw";

      const base64 = `data:${file.mimetype};base64,${file.buffer.toString(
        "base64"
      )}`;

      return cloudinary.uploader.upload(base64, {
        folder,
        resource_type: resourceType,

        // 🔥 VERY IMPORTANT FOR PDFs
        format: isPdf ? "pdf" : undefined,
        filename_override: isPdf ? `${Date.now()}.pdf` : undefined,
        use_filename: true,
        unique_filename: false,
      });
    });

    const uploaded = await Promise.all(uploadPromises);

    return uploaded.map((file) => ({
      secure_url: file.secure_url,
      public_id: file.public_id,
      resource_type: file.resource_type,
      format: file.format,
    }));
  } catch (error) {
    logger.error("File Upload Error:", error);
    throw error;
  }
}


// Delete single file
async function deleteFile(publicId: string, type: "image" | "raw" = "image") {
  try {
    return await cloudinary.uploader.destroy(publicId, {
      resource_type: type,
    });
  } catch (error) {
    logger.error("Delete Error:", error);
    throw error;
  }
}

// List images in a folder
async function listImagesInFolder(folder: string): Promise<any> {
    try {
        return await cloudinary.search
            .expression(`folder:${folder}`)
            .execute();
    } catch (error: any) {
        logger.error('List images failed', error);
        return Promise.reject({ success: false });
    }
}

// Rename image
async function renameImage(publicId: string, newPublicId: string): Promise<any> {
    try {
        return await cloudinary.uploader.rename(publicId, newPublicId);
    } catch (error: any) {
        logger.error('Rename image failed', error);
        return Promise.reject({ success: false });
    }
}

// Get image details
async function getImageDetails(publicId: string): Promise<any> {
    try {
        return await cloudinary.api.resource(publicId);
    } catch (error: any) {
        logger.error('Get image details failed', error);
        return Promise.reject({ success: false });
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function deleteAllImages(batchSize = 10, delayMs = 1000): Promise<any[]> {
    try {
        const resources = await cloudinary.api.resources({ resource_type: "image", max_results: 500 });
        const publicIds = resources.resources.map((img: any) => img.public_id);

        const results: any[] = [];
        for (let i = 0; i < publicIds.length; i += batchSize) {
            const batch = publicIds.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map((id: string) => cloudinary.uploader.destroy(id, { resource_type: "image" }))
            );
            results.push(...batchResults);
            if (i + batchSize < publicIds.length) {
                await sleep(delayMs); // Wait before next batch
            }
        }
        return results;
    } catch (error: any) {
        logger.error('Delete all images failed', error);
        return Promise.reject({ success: false });
    }
}


export { fileUploadUtil, deleteFile, listImagesInFolder, renameImage, getImageDetails, deleteAllImages }