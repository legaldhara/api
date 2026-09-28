import express, { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createPaymentRouter } from "./payment.route";

const handlers = () => ({
  createAttempt: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  confirmAttempt: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  getChargeStatus: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  getCharge: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  listMine: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  listAdmin: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  getAdminAttempt: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  reconcileAttempt: vi.fn(async (_request, response) => { response.status(200).json({}); }),
  refundAttempt: vi.fn(async (_request, response) => { response.status(200).json({}); }),
});

const authenticateAs = (role: "ADMIN" | "COADMIN" | "USER"): RequestHandler => (request, _response, next) => {
  (request as any).auth = { id: `${role.toLowerCase()}-1`, uid: "firebase-1", role, name: role };
  next();
};

describe("payment routes", () => {
  it("blocks COADMIN from issuing a refund", async () => {
    const controller = handlers();
    const app = express();
    app.use(express.json());
    app.use("/payments", createPaymentRouter({
      controller,
      authenticate: authenticateAs("COADMIN"),
      requireMfa: ((_request, _response, next) => next()),
    }));

    await request(app)
      .post("/payments/admin/attempt-1/refund")
      .send({ reason: "Duplicate payment" })
      .expect(403);

    expect(controller.refundAttempt).not.toHaveBeenCalled();
  });
});
