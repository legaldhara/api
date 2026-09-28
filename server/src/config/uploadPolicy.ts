import { extname } from "path";
import { NextFunction, Request, Response } from "express";
import multer from "multer";

const allowedExtensions: Record<string, ReadonlySet<string>> = {
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
  "application/pdf": new Set([".pdf"]),
};

export const isAllowedUpload = (file: Pick<Express.Multer.File, "mimetype" | "originalname">): boolean =>
  allowedExtensions[file.mimetype]?.has(extname(file.originalname).toLowerCase()) === true;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 4, fileSize: 10 * 1024 * 1024, fields: 4, fieldSize: 16 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!isAllowedUpload(file)) {
      callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    callback(null, true);
  },
});

export const acceptUploads = (request: Request, response: Response, next: NextFunction): void => {
  upload.array("files", 4)(request, response, (error) => {
    if (error) {
      response.status(400).json({ success: false, error: "Invalid upload" });
      return;
    }
    next();
  });
};