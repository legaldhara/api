import { AssetContext, AssetStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/db";
import { AssetStorage, cloudStorage } from "./cloudStorage";

type ActorRole = "USER" | "COADMIN" | "ADMIN";

export interface AssetActor {
  id: string;
  role: ActorRole;
}

export interface AssetRecord {
  id: string;
  ownerId: string;
  publicId: string;
  secureUrl?: string;
  resourceType: string;
  mimeType?: string;
  originalName?: string;
  sizeBytes?: number;
  status: AssetStatus;
  context: AssetContext | null;
  referenceId: string | null;
  attachedAt: Date | null;
  deletedAt: Date | null;
}

interface NewAssetRecord {
  ownerId: string;
  publicId: string;
  secureUrl: string;
  resourceType: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
}

export interface AssetRepository {
  findById(id: string): Promise<AssetRecord | null>;
  claim(input: { id: string; context: AssetContext; referenceId: string; attachedAt: Date }): Promise<AssetRecord>;
}

export interface ManagedAssetRepository extends AssetRepository {
  create(input: NewAssetRecord): Promise<AssetRecord>;
  markDeleted(id: string, deletedAt: Date): Promise<AssetRecord>;
}

export class AssetAccessError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export const createAssetRepository = (
  client: Pick<Prisma.TransactionClient, "uploadedAsset">,
): ManagedAssetRepository => ({
  findById(id) {
    return client.uploadedAsset.findUnique({ where: { id } });
  },
  create(input) {
    return client.uploadedAsset.create({ data: input });
  },
  claim(input) {
    return client.uploadedAsset.update({
      where: { id: input.id },
      data: { status: "ATTACHED", context: input.context, referenceId: input.referenceId, attachedAt: input.attachedAt },
    });
  },
  markDeleted(id, deletedAt) {
    return client.uploadedAsset.update({ where: { id }, data: { status: "DELETED", deletedAt } });
  },
});

const prismaRepository = createAssetRepository(prisma);

interface Dependencies {
  repository: AssetRepository;
  now: () => Date;
}

const dependencies = (overrides: Partial<Dependencies> = {}): Dependencies => ({
  repository: prismaRepository,
  now: () => new Date(),
  ...overrides,
});

const requireTemporaryAsset = async (assetId: string, repository: AssetRepository): Promise<AssetRecord> => {
  const asset = await repository.findById(assetId);
  if (!asset) throw new AssetAccessError("Uploaded asset not found", 404);
  if (asset.status !== "TEMPORARY") throw new AssetAccessError("Uploaded asset is no longer temporary", 409);
  return asset;
};

export const claimUploadedAsset = async (
  input: { assetId: string; actor: AssetActor; context: AssetContext; referenceId: string },
  overrides: Partial<Dependencies> = {},
): Promise<AssetRecord> => {
  const deps = dependencies(overrides);
  const asset = await requireTemporaryAsset(input.assetId, deps.repository);
  const isAdministrator = input.actor.role === "ADMIN" || input.actor.role === "COADMIN";
  if (asset.ownerId !== input.actor.id && !isAdministrator) {
    throw new AssetAccessError("Uploaded asset belongs to another account", 403);
  }
  return deps.repository.claim({ id: asset.id, context: input.context, referenceId: input.referenceId, attachedAt: deps.now() });
};

export interface AssetReference {
  assetId: string;
  url: string;
  publicId: string;
  mimeType?: string;
  originalName?: string;
  sizeBytes?: number;
}

export const extractAssetIds = (metadata: unknown): string[] => {
  if (!metadata || typeof metadata !== "object") return [];
  const documents = (metadata as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) return [];

  return [...new Set(documents.flatMap((document) => {
    if (!document || typeof document !== "object") return [];
    const assetId = (document as { assetId?: unknown }).assetId;
    return typeof assetId === "string" && assetId.trim() ? [assetId.trim()] : [];
  }))];
};

export const claimAssetReferences = async (
  input: {
    assetIds: string[];
    actor: AssetActor;
    context: AssetContext;
    referenceId: string;
  },
  overrides: Partial<Dependencies> = {},
): Promise<AssetReference[]> => {
  const references: AssetReference[] = [];
  for (const assetId of input.assetIds) {
    const asset = await claimUploadedAsset({ ...input, assetId }, overrides);
    if (!asset.secureUrl) throw new AssetAccessError("Uploaded asset is missing its storage URL", 409);
    references.push({
      assetId: asset.id,
      url: asset.secureUrl,
      publicId: asset.publicId,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      sizeBytes: asset.sizeBytes,
    });
  }
  return references;
};
export const authorizeTemporaryAssetDeletion = async (
  input: { assetId: string; actor: AssetActor },
  overrides: Partial<Pick<Dependencies, "repository">> = {},
): Promise<AssetRecord> => {
  const deps = dependencies(overrides);
  const asset = await requireTemporaryAsset(input.assetId, deps.repository);
  if (asset.ownerId !== input.actor.id && input.actor.role !== "ADMIN") {
    throw new AssetAccessError("Uploaded asset belongs to another account", 403);
  }
  return asset;
};

interface ManagedDependencies {
  repository: ManagedAssetRepository;
  storage: AssetStorage;
  now: () => Date;
}

const managedDependencies = (overrides: Partial<ManagedDependencies> = {}): ManagedDependencies => ({
  repository: prismaRepository,
  storage: cloudStorage,
  now: () => new Date(),
  ...overrides,
});

export const createManagedUploads = async (
  input: { files: Express.Multer.File[]; actor: AssetActor },
  overrides: Partial<ManagedDependencies> = {},
): Promise<AssetRecord[]> => {
  const deps = managedDependencies(overrides);
  const folderRoot = input.actor.role === "USER" ? "users" : "admins";
  const folder = `${folderRoot}/${input.actor.id}/temporary`;
  const uploaded: Array<{ publicId: string; resourceType: string; assetId?: string }> = [];
  const records: AssetRecord[] = [];

  try {
    for (const file of input.files) {
      const stored = await deps.storage.upload(file, folder);
      const tracked: { publicId: string; resourceType: string; assetId?: string } = {
        publicId: stored.publicId,
        resourceType: stored.resourceType,
      };
      uploaded.push(tracked);
      const record = await deps.repository.create({
        ownerId: input.actor.id,
        publicId: stored.publicId,
        secureUrl: stored.secureUrl,
        resourceType: stored.resourceType,
        mimeType: file.mimetype,
        originalName: file.originalname,
        sizeBytes: file.size,
      });
      tracked.assetId = record.id;
      records.push(record);
    }
    return records;
  } catch (error) {
    await Promise.allSettled(uploaded.map(async (stored) => {
      await deps.storage.delete(stored.publicId, stored.resourceType);
      if (stored.assetId) await deps.repository.markDeleted(stored.assetId, deps.now());
    }));
    throw error;
  }
};

export const deleteManagedAsset = async (
  input: { assetId: string; actor: AssetActor },
  overrides: Partial<ManagedDependencies> = {},
): Promise<AssetRecord> => {
  const deps = managedDependencies(overrides);
  const asset = await deps.repository.findById(input.assetId);
  if (!asset) throw new AssetAccessError("Uploaded asset not found", 404);
  if (asset.ownerId !== input.actor.id && input.actor.role !== "ADMIN") {
    throw new AssetAccessError("Uploaded asset belongs to another account", 403);
  }
  if (asset.status === "DELETED") return asset;
  if (asset.status !== "TEMPORARY") throw new AssetAccessError("Attached assets must be removed through their owning record", 409);

  await deps.storage.delete(asset.publicId, asset.resourceType);
  return deps.repository.markDeleted(asset.id, deps.now());
};
