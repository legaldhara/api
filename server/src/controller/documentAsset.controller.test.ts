import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assetFindUnique: vi.fn(),
  assetUpdate: vi.fn(),
  documentCreate: vi.fn(),
  createNotification: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../config/db", () => {
  const transaction = {
    uploadedAsset: { findUnique: mocks.assetFindUnique, update: mocks.assetUpdate },
    document: { create: mocks.documentCreate },
  };
  return {
    prisma: {
      document: { create: mocks.documentCreate },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) => callback(transaction)),
    },
  };
});
vi.mock("../services/Notification", () => ({ default: { createAdminNotification: mocks.createNotification } }));
vi.mock("../socket", () => ({ getIo: () => ({ to: () => ({ emit: mocks.emit }) }) }));

import { createDocument } from "./document.controller";

const response = () => {
  const value = { status: vi.fn(), json: vi.fn() };
  value.status.mockReturnValue(value);
  return value as any;
};

describe("document asset claiming", () => {
  it("stores provider metadata from the owned asset instead of request fields", async () => {
    mocks.assetFindUnique.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      publicId: "users/user-1/temporary/provider-file",
      secureUrl: "https://cdn.example.com/provider-file",
      resourceType: "raw",
      status: "TEMPORARY",
      context: null,
      referenceId: null,
      attachedAt: null,
      deletedAt: null,
    });
    mocks.assetUpdate.mockImplementation(({ data }: any) => Promise.resolve({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      publicId: "users/user-1/temporary/provider-file",
      secureUrl: "https://cdn.example.com/provider-file",
      resourceType: "raw",
      status: data.status,
      context: data.context,
      referenceId: data.referenceId,
      attachedAt: data.attachedAt,
      deletedAt: null,
    }));
    mocks.documentCreate.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
    const res = response();

    await createDocument({
      auth: { id: "11111111-1111-4111-8111-111111111111", role: "USER", name: "User One" },
      body: {
        title: "Identity proof",
        assetId: "22222222-2222-4222-8222-222222222222",
        url: "https://attacker.example/file",
        publicId: "attacker-file",
      },
    } as any, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.documentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      url: "https://cdn.example.com/provider-file",
      publicId: "users/user-1/temporary/provider-file",
    }) });
  });
});
