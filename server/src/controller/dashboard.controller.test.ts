import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
}));

vi.mock("../config/db", () => ({
  prisma: {
    paymentCharge: { groupBy: mocks.groupBy },
  },
}));

import { getRevenueAndCountByPaymentType } from "./dashboard.controller";

describe("payment revenue dashboard", () => {
  beforeEach(() => {
    mocks.groupBy.mockReset();
    mocks.groupBy.mockResolvedValue([]);
  });

  it("counts revenue from paid charges only", async () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getRevenueAndCountByPaymentType({} as never, response as never);

    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PAID" },
    }));
  });
});
