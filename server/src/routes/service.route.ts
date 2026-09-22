import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import {
  createService,
  updateService,
  deleteService,
  getService,
  getAllServices,
} from "../controller/service.controller";

const serviceRouter = express.Router();

serviceRouter.get("/services", asyncHandler(getAllServices));
serviceRouter.get("/:id", asyncHandler(getService));

serviceRouter.use(authenticate);

serviceRouter.use(authorize("ADMIN","COADMIN"));

serviceRouter.post("/create", asyncHandler(createService));
serviceRouter.put("/:id", asyncHandler(updateService));
serviceRouter.delete("/:id", asyncHandler(deleteService));

export default serviceRouter;
