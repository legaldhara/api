import { describe, expect, it } from "vitest";
import { AssetRecord, AssetRepository, claimAssetReferences, extractAssetIds } from "./uploadedAsset";

class MemoryRepository implements AssetRepository {
  constructor(private readonly assets: AssetRecord[]) {}

  async findById(id: string) {
    return this.assets.find((asset) => asset.id === id) || null;
  }

  async claim(input: { id: string; context: AssetRecord["context"]; referenceId: string; attachedAt: Date }) {
    const asset = await this.findById(input.id);
    if (!asset) throw new Error("not found");
    Object.assign(asset, { status: "ATTACHED", ...input });
    return asset;
  }
}

describe("asset references", () => {
  it("extracts only unique asset IDs from untrusted document metadata", () => {
    expect(extractAssetIds({
      documents: [
        { assetId: "asset-1", url: "https://attacker.test/one" },
        { assetId: "asset-1" },
        { assetId: "asset-2" },
        { publicId: "attacker" },
      ],
    })).toEqual(["asset-1", "asset-2"]);
  });

  it("returns only server-owned attachment metadata", async () => {
    const repository = new MemoryRepository([{
      id: "asset-1",
      ownerId: "user-1",
      publicId: "users/user-1/provider-file",
      secureUrl: "https://cdn.example.com/provider-file",
      resourceType: "raw",
      mimeType: "application/pdf",
      originalName: "evidence.pdf",
      sizeBytes: 1024,
      status: "TEMPORARY",
      context: null,
      referenceId: null,
      attachedAt: null,
      deletedAt: null,
    }]);

    const references = await claimAssetReferences({
      assetIds: ["asset-1"],
      actor: { id: "user-1", role: "USER" },
      context: "APPLICATION_UPDATE",
      referenceId: "update-1",
    }, { repository, now: () => new Date("2026-09-26T10:00:00.000Z") });

    expect(references).toEqual([{
      assetId: "asset-1",
      url: "https://cdn.example.com/provider-file",
      publicId: "users/user-1/provider-file",
      mimeType: "application/pdf",
      originalName: "evidence.pdf",
      sizeBytes: 1024,
    }]);
  });
});
