import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { AuthRequest } from "../types/custom";
import { prisma } from "../config/db";
import Notification from '../services/Notification'
import { getIo } from "../socket";
import { AssetAccessError, claimUploadedAsset, createAssetRepository } from "../services/uploadedAsset";
// 🟢 Create Document (User or Admin)
export const createDocument = async (req: Request, res: Response) => {
  const user = (req as AuthRequest).auth;
  if (!user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });

  const { title, description, assetId } = req.body;
  if (!title || !assetId) {
    return res.status(400).json({ success: false, message: "Title and asset ID are required" });
  }

  try {
    const documentId = randomUUID();
    const document = await prisma.$transaction(async (transaction) => {
      const asset = await claimUploadedAsset({
        assetId,
        actor: user,
        context: "DOCUMENT",
        referenceId: documentId,
      }, { repository: createAssetRepository(transaction) });

      return transaction.document.create({
        data: {
          id: documentId,
          title,
          description,
          url: asset.secureUrl!,
          publicId: asset.publicId,
          userId: user.id,
        },
      });
    });

    await Notification.createAdminNotification({
      title: `New Document Received: #${title}`,
      body: `A new document has been submitted by ${user.name}.`,
      notificationType: "document",
      role: "ADMIN",
      audienceType: "SPECIFIC",
      clickAction: "/documents",
    });

    getIo().to("ADMINS").emit("new-notification", {
      trackingId: "",
      message: `New document submitted by ${user.name}`,
      status: document.url ? "success" : "pending",
      createdAt: new Date(),
      clickAction: "/documents",
    });

    return res.status(201).json({ success: true, data: document });
  } catch (err) {
    if (err instanceof AssetAccessError) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// 🟡 Get All Documents (User → own | Admin → all)

export const getDocuments = async (req: Request, res: Response) => {
  const user = (req as AuthRequest).auth;
  if (!user)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    // 🔹 Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // 🔹 Filters & search
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const type = (req.query.type as string) || "";

    // 🔹 Base where condition
    const where: any = user.role === "ADMIN" ? {} : { userId: user.id };

    // 🔹 Search by file name, user name, or publicId
    if (search) {
      where.OR = [
        { fileName: { contains: search, mode: "insensitive" } },
        { publicId: { contains: search, mode: "insensitive" } },
        { user: { fullName: { contains: search, mode: "insensitive" } } },
      ];
    }

    // 🔹 Optional filters
    if (status) where.status = status;
    if (type) where.type = type;

    // 🔹 Fetch data
    const [documents, totalCount] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { fullName: true, email: true, createdAt: true },
          },
        },
      }),
      prisma.document.count({ where }),
    ]);

    // 🔹 Group documents by user
    const grouped = documents.reduce((acc: any[], doc) => {
      const existingUser = acc.find(
        (u) => u.user.email === doc.user.email
      );

      const docData = {
        // id: doc.id,
        title: doc.title,
        publicId: doc.publicId,
        url: doc.url,
        // type: doc.type,
        createdAt: doc.createdAt,

      };

      if (existingUser) {
        existingUser.documents.push(docData);
      } else {
        acc.push({
          user: {
            fullName: doc.user.fullName,
            email: doc.user.email,
            createdAt: doc.user.createdAt,
          },
          documents: [docData],
        });
      }

      return acc;
    }, []);

    const totalPages = Math.ceil(totalCount / limit);

    return res.json({
      success: true,
      data: grouped,
      pagination: { totalCount, page, totalPages, limit },
    });
  } catch (err) {
    console.error("Error fetching documents:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};



// 🟠 Update Document (User → own | Admin → any)
export const updateDocument = async (req: Request, res: Response) => {
  const user = (req as AuthRequest).auth;
  const { id } = req.params;
  const { title, description } = req.body;

  if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Document not found" });

    if (user.role !== "ADMIN" && existing.userId !== user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const updated = await prisma.document.update({
      where: { id },
      data: { title, description },
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// 🔴 Delete Document (User → own | Admin → any)
export const deleteDocument = async (req: Request, res: Response) => {
  const user = (req as AuthRequest).auth;
  const { id } = req.params;

  if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Document not found" });

    if (user.role !== "ADMIN" && existing.userId !== user.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    await prisma.document.delete({ where: { id } });
    return res.json({ success: true, message: "Document deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
