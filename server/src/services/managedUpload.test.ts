import { describe, expect, it } from "vitest";
import { AssetRecord, AssetRepository, createManagedUploads, deleteManagedAsset } from "./uploadedAsset";

class MemoryRepository implements AssetRepository {
  records: AssetRecord[] = [];

  async findById(id: string) {
    return this.records.find((record) => record.id === id) || null;
  }

  async create(input: Omit<AssetRecord, "id" | "status" | "context" | "referenceId" | "attachedAt" | "deletedAt">) {
    const record: AssetRecord = {
      ...input,
      id: `asset-${this.records.length + 1}`,
      status: "TEMPORARY",
      context: null,
      referenceId: null,
      attachedAt: null,
      deletedAt: null,
    };
    this.records.push(record);
    return record;
  }

  async claim(): Promise<AssetRecord> {
    throw new Error("not used");
  }

  async markDeleted(id: string, deletedAt: Date) {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) throw new Error("Asset not found");
    this.records[index] = { ...this.records[index], status: "DELETED", deletedAt };
    return this.records[index];
  }
}

const file = (name: string): Express.Multer.File => ({
  originalname: name,
  mimetype: "image/png",
  size: 12,
} as Express.Multer.File);

describe("managed uploads", () => {
  it("stores uploads in a server-generated account folder", async () => {
    const repository = new MemoryRepository();
    const folders: string[] = [];
    const storage = {
      upload: async (_file: Express.Multer.File, folder: string) => {
        folders.push(folder);
        return { publicId: "provider-1", secureUrl: "https://cdn.example.com/provider-1", resourceType: "image" };
      },
      delete: async () => "deleted" as const,
    };

    const result = await createManagedUploads({ files: [file("evidence.png")], actor: { id: "user-1", role: "USER" } }, { repository, storage });

    expect(folders).toEqual(["users/user-1/temporary"]);
    expect(result).toEqual([expect.objectContaining({ ownerId: "user-1", publicId: "provider-1", originalName: "evidence.png" })]);
  });

  it("cleans up provider objects when a later upload fails", async () => {
    const repository = new MemoryRepository();
    const deleted: string[] = [];
    let calls = 0;
    const storage = {
      upload: async () => {
        calls += 1;
        if (calls === 2) throw new Error("provider unavailable");
        return { publicId: "provider-1", secureUrl: "https://cdn.example.com/provider-1", resourceType: "image" };
      },
      delete: async (publicId: string) => { deleted.push(publicId); return "deleted" as const; },
    };

    await expect(createManagedUploads({ files: [file("one.png"), file("two.png")], actor: { id: "user-1", role: "USER" } }, { repository, storage }))
      .rejects.toThrow("provider unavailable");
    expect(deleted).toEqual(["provider-1"]);
    expect(repository.records[0]).toMatchObject({ status: "DELETED" });
  });

  it("treats repeated deletion as success without contacting storage", async () => {
    const repository = new MemoryRepository();
    repository.records.push({
      id: "asset-1",
      ownerId: "user-1",
      publicId: "provider-1",
      secureUrl: "https://cdn.example.com/provider-1",
      resourceType: "image",
      mimeType: "image/png",
      originalName: "one.png",
      sizeBytes: 12,
      status: "DELETED",
      context: null,
      referenceId: null,
      attachedAt: null,
      deletedAt: new Date("2026-09-26T10:00:00.000Z"),
    });
    let deletes = 0;
    const storage = {
      upload: async () => { throw new Error("not used"); },
      delete: async () => { deletes += 1; return "deleted" as const; },
    };

    const result = await deleteManagedAsset({ assetId: "asset-1", actor: { id: "user-1", role: "USER" } }, { repository, storage });

    expect(result.status).toBe("DELETED");
    expect(deletes).toBe(0);
  });
});
