import express from "express";
import { asyncHandler } from "../utils/lib";
import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { createUserQuery, getAllUserQueries, getQueryById, resolveQueryById } from "../controller/query.controller";

const queryRouter = express.Router();

queryRouter.post("/postquery", asyncHandler(createUserQuery));

queryRouter.use(authenticate);

queryRouter.use(authorize("ADMIN","COADMIN"));

queryRouter.get("/allqueries", asyncHandler(getAllUserQueries));

queryRouter.get("/:queryNo", asyncHandler(getQueryById));

queryRouter.put("/resolve/:queryNo", asyncHandler(resolveQueryById))

export default queryRouter;
