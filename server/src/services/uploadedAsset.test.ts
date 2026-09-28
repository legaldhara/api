import { describe, expect, it } from "vitest";
import {
  AssetRecord,
  AssetRepository,
  authorizeTemporaryAssetDeletion,
  claimUploadedAsset,
} from "./uploadedAsset";

class MemoryAssetRepository implements AssetRepository {
  constructor(private asset: AssetRecord | null) {}

  async findById(id: string): Promise<AssetRecord | null> {
    return this.asset?.id === id ? this.asset : null;
  }

  async claim(input: {
    id: string;
    context: AssetRecord["context"];
    referenceId: string;
    attachedAt: Date;
  }): Promise<AssetRecord> {
    if (!this.asset || this.asset.id !== input.id) throw new Error("Asset not found");
    this.asset = {
      ...this.asset,
      status: "ATTACHED",
      context: input.context,
      referenceId: input.referenceId,
      attachedAt: input.attachedAt,
    };
    return this.asset;
  }
}

const temporaryAsset = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: "asset-1",
  ownerId: "user-1",
  publicId: "users/user-1/temporary/file-1",
  resourceType: "image",
  status: "TEMPORARY",
  context: null,
  referenceId: null,
  attachedAt: null,
  deletedAt: null,
  ...overrides,
});

describe("uploaded asset authorization", () => {
  it("rejects claiming an asset owned by another user", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset({ ownerId: "user-2" }));

    await expect(claimUploadedAsset({
      assetId: "asset-1",
      actor: { id: "user-1", role: "USER" },
      context: "DOCUMENT",
      referenceId: "document-1",
    }, { repository, now: () => new Date("2026-09-26T10:00:00.000Z") }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("claims an owner's temporary asset for one domain record", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset());

    await expect(claimUploadedAsset({
      assetId: "asset-1",
      actor: { id: "user-1", role: "USER" },
      context: "DOCUMENT",
      referenceId: "document-1",
    }, { repository, now: () => new Date("2026-09-26T10:00:00.000Z") }))
      .resolves.toMatchObject({
        status: "ATTACHED",
        context: "DOCUMENT",
        referenceId: "document-1",
        attachedAt: new Date("2026-09-26T10:00:00.000Z"),
      });
  });

  it("rejects claiming an asset that is already attached", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset({ status: "ATTACHED" }));

    await expect(claimUploadedAsset({
      assetId: "asset-1",
      actor: { id: "user-1", role: "USER" },
      context: "DOCUMENT",
      referenceId: "document-2",
    }, { repository }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("allows ADMIN to delete another user's temporary asset", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset({ ownerId: "user-2" }));

    await expect(authorizeTemporaryAssetDeletion({
      assetId: "asset-1",
      actor: { id: "admin-1", role: "ADMIN" },
    }, { repository })).resolves.toMatchObject({ id: "asset-1" });
  });

  it("does not allow COADMIN to delete another user's temporary asset", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset({ ownerId: "user-2" }));

    await expect(authorizeTemporaryAssetDeletion({
      assetId: "asset-1",
      actor: { id: "coadmin-1", role: "COADMIN" },
    }, { repository })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects generic deletion of an attached asset", async () => {
    const repository = new MemoryAssetRepository(temporaryAsset({ status: "ATTACHED" }));

    await expect(authorizeTemporaryAssetDeletion({
      assetId: "asset-1",
      actor: { id: "admin-1", role: "ADMIN" },
    }, { repository })).rejects.toMatchObject({ statusCode: 409 });
  });
});
