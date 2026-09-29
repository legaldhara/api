import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("../../config/db", () => ({
  prisma: {
    paymentAttempt: {
      findMany: mocks.findMany,
      count: mocks.count,
    },
  },
}));

import { listAdmin } from "./payment.controller";

describe("admin payment history", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.count.mockReset();
    mocks.findMany.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
  });

  it("searches users and references across every payment target", async () => {
    const request = { query: { search: "legal", page: "2", limit: "20" } };
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await listAdmin(request as never, response as never);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }));
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("ticketNo");
    expect(JSON.stringify(where)).toContain("requestNo");
    expect(JSON.stringify(where)).toContain("fullName");
    expect(JSON.stringify(where)).toContain("email");
  });
});
